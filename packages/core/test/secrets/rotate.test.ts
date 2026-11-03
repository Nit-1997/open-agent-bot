import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseCredentialKeys } from "../../src/hosted/config.js";
import { open, type Sealed, seal } from "../../src/secrets/envelope.js";
import { LocalKeyWrapper } from "../../src/secrets/keyWrapper.js";
import { type RotationRepo, rotateStale } from "../../src/hosted/secrets/rotate.js";
import { ROTATION_BATCH, type RotationCursor, type StaleCredential } from "../../src/hosted/store/rotation.js";

const k1 = randomBytes(32).toString("base64");
const k2 = randomBytes(32).toString("base64");
const oldWrapper = new LocalKeyWrapper(parseCredentialKeys(`v1:${k1}`));
const wrapper = new LocalKeyWrapper(parseCredentialKeys(`v2:${k2},v1:${k1}`));

const user = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ctx = (c: { userId: string; provider: string }) => ({ userId: c.userId, provider: c.provider, kind: "api_key" as const });

class MemoryRotation implements RotationRepo {
  rows = new Map<string, StaleCredential>();
  staleCalls = 0;
  loseRaceFor = new Set<string>();

  async add(n: number, provider: string, opts: { corrupt?: boolean } = {}) {
    const c = { userId: user(n), provider };
    let sealed: Sealed = await seal(oldWrapper, Buffer.from(`key-${n}-${provider}`), ctx(c));
    if (opts.corrupt) sealed = { ...sealed, dekWrapped: randomBytes(sealed.dekWrapped.length) };
    this.rows.set(`${c.userId}/${provider}`, { ...c, kind: "api_key", version: 1, sealed });
  }

  private sorted() {
    return [...this.rows.values()].sort((a, b) =>
      a.userId === b.userId ? a.provider.localeCompare(b.provider) : a.userId.localeCompare(b.userId),
    );
  }

  async stale(below: number, after?: RotationCursor) {
    this.staleCalls++;
    if (this.staleCalls > 1000) throw new Error("rotation does not terminate");
    return this.sorted()
      .filter((r) => r.sealed.keyVersion < below)
      .filter((r) => !after || r.userId > after.userId || (r.userId === after.userId && r.provider > after.provider))
      .slice(0, ROTATION_BATCH)
      .map((r) => structuredClone(r));
  }

  async get(userId: string, provider: string) {
    const r = this.rows.get(`${userId}/${provider}`);
    return r && structuredClone(r);
  }

  async replaceWrap(c: StaleCredential, next: Sealed) {
    const key = `${c.userId}/${c.provider}`;
    const cur = this.rows.get(key)!;
    if (this.loseRaceFor.delete(key)) {
      cur.version++;
      return false;
    }
    if (cur.version !== c.version) return false;
    this.rows.set(key, { ...cur, version: cur.version + 1, sealed: next });
    return true;
  }

  async countBelow(version: number) {
    return [...this.rows.values()].filter((r) => r.sealed.keyVersion < version).length;
  }
}

describe("rotateStale", () => {
  it("rewraps every row under the current key and keeps the values readable", async () => {
    const repo = new MemoryRotation();
    for (let n = 1; n <= 3; n++) await repo.add(n, "openrouter");
    const lines: string[] = [];
    expect(await rotateStale(repo, wrapper, (l) => lines.push(l))).toEqual({ rewrapped: 3, failed: 0, left: 0, current: 2 });
    for (const r of repo.rows.values()) {
      expect(r.sealed.keyVersion).toBe(2);
      expect((await open(wrapper, r.sealed, ctx(r))).toString()).toBe(`key-${Number(r.userId.slice(-12))}-openrouter`);
    }
    expect(lines).toEqual([]);
  });

  it("moves past more than a batch of broken rows and still rotates the good ones after them", async () => {
    const repo = new MemoryRotation();
    for (let n = 1; n <= ROTATION_BATCH + 5; n++) await repo.add(n, "anthropic", { corrupt: true });
    for (let n = ROTATION_BATCH + 6; n <= ROTATION_BATCH + 8; n++) await repo.add(n, "anthropic");
    const lines: string[] = [];
    const report = await rotateStale(repo, wrapper, (l) => lines.push(l));
    expect(report).toEqual({ rewrapped: 3, failed: ROTATION_BATCH + 5, left: ROTATION_BATCH + 5, current: 2 });
    expect(repo.staleCalls).toBe(3);
    expect(lines[0]).toMatch(/integrity check/);
    expect(lines.join("\n")).not.toMatch(/key-/);
  });

  it("re-reads and retries once when another writer won the race", async () => {
    const repo = new MemoryRotation();
    await repo.add(1, "openai");
    await repo.add(2, "openai");
    repo.loseRaceFor.add(`${user(1)}/openai`);
    expect(await rotateStale(repo, wrapper, () => {})).toEqual({ rewrapped: 2, failed: 0, left: 0, current: 2 });
    expect(repo.rows.get(`${user(1)}/openai`)?.version).toBe(3);
  });

  it("skips a row another writer already rotated", async () => {
    const repo = new MemoryRotation();
    await repo.add(1, "openai");
    const key = `${user(1)}/openai`;
    const original = repo.replaceWrap.bind(repo);
    let first = true;
    repo.replaceWrap = async (c, next) => {
      if (first) {
        first = false;
        const cur = repo.rows.get(key)!;
        repo.rows.set(key, { ...cur, version: cur.version + 1, sealed: next });
        return false;
      }
      return original(c, next);
    };
    expect(await rotateStale(repo, wrapper, () => {})).toEqual({ rewrapped: 0, failed: 0, left: 0, current: 2 });
  });
});

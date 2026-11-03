import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServicePins } from "../src/main/services.ts";
import { loadPins, writeAcceptedServices } from "../src/main/servicesFile.ts";
import { bundledComposeSha } from "../src/main/stackFiles.ts";

let dir: string;
let bundledDir: string;
let servicesFile: string;
let lines: string[];
const log = { info: (l: string) => lines.push(l), warn: (l: string) => lines.push(l), error: (l: string) => lines.push(l) };

const D = (c: string) => c.repeat(64);
const ref = (repo: string, c: string) => `127.0.0.1:18477/${repo}@sha256:${D(c)}`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oab-svcfile-"));
  bundledDir = join(dir, "bundle");
  mkdirSync(bundledDir);
  writeFileSync(join(bundledDir, "docker-compose.yml"), "services: {}\n");
  servicesFile = join(dir, "state/services.json");
  lines = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const sha = () => bundledComposeSha(bundledDir);
const dev = (version: string, c: string, o: Record<string, unknown> = {}) => ({
  schema: 1,
  kind: "dev",
  version,
  composeSha256: sha(),
  images: { agent: ref("oab-m4-agent", c), search: ref("oab-m4-search", c) },
  pull: true,
  ...o,
});
const lock = (v: unknown) => {
  const file = join(dir, "dev-services.json");
  writeFileSync(file, JSON.stringify(v));
  return file;
};
const pinsOf = (v: ReturnType<typeof dev>): ServicePins => ({
  kind: "dev",
  version: v.version,
  composeSha256: v.composeSha256,
  images: v.images,
  pull: v.pull,
});
const load = (o: { override?: string } = {}) =>
  loadPins({ bundledDir, servicesOverride: o.override, servicesFile, test: true, shellVersion: "0.0.0-dev", log });

describe("loadPins (D12 effective pins)", () => {
  it("no compose file → stack_missing; an unreadable lock → unreadable", () => {
    rmSync(join(bundledDir, "docker-compose.yml"));
    expect(load()).toEqual({ ok: false, reason: "stack_missing" });
    writeFileSync(join(bundledDir, "docker-compose.yml"), "services: {}\n");
    expect(load()).toEqual({ ok: false, reason: "unreadable" });
  });

  it("uses the bundled lock when services.json is missing", () => {
    const a = dev("0.0.0-a", "a");
    expect(load({ override: lock(a) })).toEqual({ ok: true, pins: pinsOf(a) });
    expect(lines).toEqual([]);
  });

  it("a newer accepted manifest wins; an older one loses to the bundled lock", () => {
    const a = dev("0.0.0-a", "a");
    const b = dev("0.0.0-b", "b");
    writeAcceptedServices(servicesFile, pinsOf(b), "0.0.0-a");
    expect(load({ override: lock(a) })).toEqual({ ok: true, pins: pinsOf(b) });
    const c = dev("0.0.0-c", "c");
    expect(load({ override: lock(c) })).toEqual({ ok: true, pins: pinsOf(c) });
  });

  it("writes services.json 0600 with the version it replaced", () => {
    const b = dev("0.0.0-b", "b");
    writeAcceptedServices(servicesFile, { ...pinsOf(b), minShellVersion: "0.0.0-dev" }, "0.0.0-a", new Date("2026-11-03T12:00:00Z"));
    expect(statSync(servicesFile).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(servicesFile, "utf8"))).toEqual({
      schema: 1,
      acceptedAt: "2026-11-03T12:00:00.000Z",
      replaced: "0.0.0-a",
      manifest: { ...b, minShellVersion: "0.0.0-dev" },
    });
  });

  it("ignores an accepted manifest for another compose file, and says why", () => {
    const a = dev("0.0.0-a", "a");
    writeAcceptedServices(servicesFile, { ...pinsOf(dev("0.0.0-b", "b")), composeSha256: D("9") }, "0.0.0-a");
    expect(load({ override: lock(a) })).toEqual({ ok: true, pins: pinsOf(a) });
    expect(lines).toContain("[update] services.json ignored: compose_mismatch");
  });

  it("ignores a services.json with a wide mode or bad content", () => {
    const a = dev("0.0.0-a", "a");
    writeAcceptedServices(servicesFile, pinsOf(dev("0.0.0-b", "b")), "0.0.0-a");
    chmodSync(servicesFile, 0o644);
    expect(load({ override: lock(a) })).toEqual({ ok: true, pins: pinsOf(a) });
    expect(lines).toContain("[update] services.json ignored: wide_mode");
    writeFileSync(servicesFile, "{", { mode: 0o600 });
    chmodSync(servicesFile, 0o600);
    lines = [];
    expect(load({ override: lock(a) })).toEqual({ ok: true, pins: pinsOf(a) });
    expect(lines).toContain("[update] services.json ignored: malformed");
  });

  it("a local lock is never replaced", () => {
    const localLock = {
      schema: 1,
      kind: "local",
      version: "local-abc1234",
      composeSha256: sha(),
      images: { agent: "open-agent:local", search: "open-agent-search:local" },
      imageIds: { agent: `sha256:${D("c")}`, search: `sha256:${D("d")}` },
      pull: false,
    };
    writeAcceptedServices(servicesFile, pinsOf(dev("9.0.0", "b")), "local-abc1234");
    const r = load({ override: lock(localLock) });
    expect(r).toMatchObject({ ok: true, pins: { kind: "local", version: "local-abc1234" } });
  });

  it("an invalid bundled lock is reported, whatever services.json holds", () => {
    writeAcceptedServices(servicesFile, pinsOf(dev("0.0.0-b", "b")), "0.0.0-a");
    expect(load({ override: lock({ ...dev("0.0.0-a", "a"), images: null }) })).toEqual({ ok: false, reason: "no_pins" });
  });
});

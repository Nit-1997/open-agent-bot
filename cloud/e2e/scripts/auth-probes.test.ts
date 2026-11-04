import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { type ProbeIo, runAuthProbes } from "./auth-probes.mts";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "auth-probes.mts");
const APP = "http://localhost:18300";
const AGENT = "http://127.0.0.1:18800";

function spies() {
  const calls = { fetch: 0, prepare: 0, finish: 0 };
  const lines: string[] = [];
  const io: ProbeIo = {
    fetch: async () => {
      calls.fetch += 1;
      throw new Error("no network in this test");
    },
    prepare: async () => {
      calls.prepare += 1;
      throw new Error("no setup in this test");
    },
    finish: async () => {
      calls.finish += 1;
      return 0;
    },
    log: (line) => lines.push(line),
  };
  return { io, calls, lines };
}

describe("auth probes origin guard", () => {
  const refused: Array<[string, Record<string, string | undefined>, RegExp]> = [
    ["a missing AGENT_ORIGIN", { APP_ORIGIN: APP }, /AGENT_ORIGIN is not set/],
    ["a live AGENT_ORIGIN", { APP_ORIGIN: APP, AGENT_ORIGIN: "http://127.0.0.1:8000" }, /AGENT_ORIGIN must be/],
    ["a look-alike AGENT_ORIGIN", { APP_ORIGIN: APP, AGENT_ORIGIN: "http://localhost:18300.evil.com" }, /AGENT_ORIGIN must be/],
    ["a userinfo AGENT_ORIGIN", { APP_ORIGIN: APP, AGENT_ORIGIN: "http://localhost:18800@evil.com" }, /AGENT_ORIGIN must be/],
    ["a missing APP_ORIGIN", { AGENT_ORIGIN: AGENT }, /APP_ORIGIN is not set/],
    ["the live APP_ORIGIN", { APP_ORIGIN: "https://app.localhost", AGENT_ORIGIN: AGENT }, /APP_ORIGIN must be/],
    ["a userinfo APP_ORIGIN", { APP_ORIGIN: "http://user:pw@localhost:18300", AGENT_ORIGIN: AGENT }, /APP_ORIGIN must be/],
  ];
  for (const [name, env, message] of refused) {
    it(`refuses ${name} before any network call`, async () => {
      const { io, calls, lines } = spies();
      assert.equal(await runAuthProbes(env, io), 1);
      assert.deepEqual(calls, { fetch: 0, prepare: 0, finish: 0 });
      assert.match(lines.join("\n"), message);
    });
  }

  it("checks both origins and reports every problem", async () => {
    const { io, lines } = spies();
    assert.equal(await runAuthProbes({ APP_ORIGIN: "https://app.localhost", AGENT_ORIGIN: "http://127.0.0.1:8000" }, io), 1);
    assert.match(lines.join("\n"), /APP_ORIGIN must be/);
    assert.match(lines.join("\n"), /AGENT_ORIGIN must be/);
  });

  it("exits non-zero when run as a script with a bad AGENT_ORIGIN", () => {
    const env: NodeJS.ProcessEnv = { ...process.env, APP_ORIGIN: APP, AGENT_ORIGIN: "http://localhost:18800.evil.com" };
    const run = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", SCRIPT], { env, encoding: "utf8" });
    assert.equal(run.status, 1, `${run.stdout}${run.stderr}`);
    assert.match(`${run.stdout}${run.stderr}`, /refusing to probe: AGENT_ORIGIN must be/);
  });
});

describe("auth probes verdicts", () => {
  const session = { secret: "s", demoToken: "d", demoCookie: "c=1", otherToken: "o", bigSur: "3b5b95a8-e14f-46ff-aafa-f10459285381" };
  const env = { APP_ORIGIN: APP, AGENT_ORIGIN: AGENT };

  it("fails and still cleans up when a refusal is not refused", async () => {
    const urls: string[] = [];
    const lines: string[] = [];
    let finished = 0;
    const io: ProbeIo = {
      fetch: async (url) => {
        urls.push(url);
        return Response.json({ ok: true });
      },
      prepare: async () => session,
      finish: async () => {
        finished += 1;
        return 2;
      },
      log: (line) => lines.push(line),
    };
    assert.equal(await runAuthProbes(env, io), 1);
    assert.equal(finished, 1);
    assert.ok(lines.includes("e2e users cleaned up: 2 removed"), lines.join("\n"));
    assert.ok(urls.length > 0 && urls.every((url) => url.startsWith(`${APP}/`) || url.startsWith(`${AGENT}/`)), urls.join("\n"));
    assert.match(lines.join("\n"), /FAIL web, no cookies: GET localhost:18300\/api\/chats -> 200/);
    assert.match(lines.at(-1) ?? "", /SOME PROBES FAILED/);
    assert.doesNotMatch(lines.join("\n"), /Bearer|c=1/);
  });

  it("fails and cleans up when setup throws", async () => {
    let finished = 0;
    const lines: string[] = [];
    const io: ProbeIo = {
      fetch: async () => assert.fail("no request after a failed setup"),
      prepare: async () => {
        throw new Error("setup broke");
      },
      finish: async () => {
        finished += 1;
        return 0;
      },
      log: (line) => lines.push(line),
    };
    assert.equal(await runAuthProbes(env, io), 1);
    assert.equal(finished, 1);
    assert.match(lines.join("\n"), /probe run failed: setup broke/);
    assert.ok(lines.includes("e2e users cleaned up: 0 removed"), lines.join("\n"));
  });
});

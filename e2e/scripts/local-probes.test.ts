import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { localProbes, probeTarget, runLocalProbes, type Send } from "./local-probes.mts";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "local-probes.mts");

describe("local probes target guard", () => {
  for (const target of [
    undefined,
    "",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:8000",
    "http://app.localhost",
    "https://app.localhost",
    "https://127.0.0.1:18340",
    "http://localhost:18340",
    "http://127.0.0.1:18340/",
    "http://127.0.0.1:20000",
    "http://user:pw@127.0.0.1:18340",
  ]) {
    it(`refuses ${target ?? "a missing APP_ORIGIN"}`, async () => {
      assert.throws(() => probeTarget(target), /refusing to probe/);
      let sent = 0;
      const send: Send = async () => {
        sent += 1;
        return { status: 200, acao: 0 };
      };
      await assert.rejects(
        runLocalProbes(target, () => {}, send),
        /refusing to probe/,
      );
      assert.equal(sent, 0);
    });
  }

  it("redacts userinfo in the refusal", () =>
    assert.throws(
      () => probeTarget("http://u:secret@127.0.0.1:18340"),
      (err: Error) => !err.message.includes("secret") && err.message.includes("***@"),
    ));

  it("accepts 127.0.0.1 on an 18xxx port", () =>
    assert.deepEqual(probeTarget("http://127.0.0.1:18340"), { origin: "http://127.0.0.1:18340", port: 18340 }));

  it("the script exits 2 without sending anything for app.localhost", () => {
    const run = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", SCRIPT], {
      env: { ...process.env, APP_ORIGIN: "https://app.localhost" },
      encoding: "utf8",
    });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /refusing to probe/);
  });
});

describe("local probes table", () => {
  const origin = "http://127.0.0.1:18340";
  const probes = localProbes(origin, 18340);

  it("covers rebinding, foreign origins, fetch metadata, no-CORS and a same-origin control", () => {
    const names = probes.map((p) => p.name);
    for (const name of [
      "wrong Host on /",
      "wrong Host on /api/chats",
      "PUT /api/profile, foreign Origin",
      "PUT /api/profile, Origin null",
      "PUT /api/profile, no Origin",
      "GET /api/chats, Sec-Fetch-Site cross-site",
      "GET /api/chats, Sec-Fetch-Site same-site",
      "OPTIONS /api/chats",
      "OPTIONS /api/profile",
      "OPTIONS /api/copilotkit/info",
      "OPTIONS /",
      "GET /api/chats, foreign Origin",
      "GET /api/chats, same origin (control)",
    ]) {
      assert.ok(names.includes(name), name);
    }
  });

  it("counts any Access-Control-Allow-* header as unexpected and prints no bodies", async () => {
    const lines: string[] = [];
    const send: Send = async (method, path, headers) => {
      const probe = probes.find((p) => p.method === method && p.path === path && JSON.stringify(p.headers) === JSON.stringify(headers));
      const status = typeof probe?.expect === "number" ? probe.expect : 404;
      return { status, acao: method === "OPTIONS" && path === "/api/chats" ? 1 : 0 };
    };
    assert.equal(await runLocalProbes(origin, (l) => lines.push(l), send), 1);
    assert.match(lines.find((l) => l.startsWith("OPTIONS /api/chats")) ?? "", /UNEXPECTED/);
    assert.match(lines.at(-1) ?? "", /1 unexpected/);
  });

  it("flags a wrong status", async () => {
    const send: Send = async () => ({ status: 200, acao: 0 });
    assert.ok((await runLocalProbes(origin, () => {}, send)) > 0);
  });
});

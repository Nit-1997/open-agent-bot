import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCoreConfig } from "../src/config.js";
import type { Identity } from "../src/identity/types.js";
import type { KeyWrapper } from "../src/secrets/keyWrapper.js";
import { type RunningAgent, startAgent } from "../src/startAgent.js";
import { wrapper } from "./fixtures/app.js";
import { MemoryDb } from "./fixtures/memoryRepos.js";
import { ALICE } from "./fixtures/users.js";

const identity: Identity = {
  kind: "local",
  admitCaller: () => undefined,
  authenticate: async () => ({ ok: true, principal: ALICE }),
};

const running: RunningAgent[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((a) => a.close()));
});

describe("startAgent secrets", () => {
  it("seals provider keys with the injected key wrapper", async () => {
    const spy: KeyWrapper = {
      get currentVersion() {
        return wrapper.currentVersion;
      },
      wrap: vi.fn((dek: Buffer, aad: Buffer) => wrapper.wrap(dek, aad)),
      unwrap: vi.fn((w: Buffer, n: Buffer, v: number, aad: Buffer) => wrapper.unwrap(w, n, v, aad)),
    };
    const store = new MemoryDb();
    const agent = await startAgent({
      config: loadCoreConfig({ RENDERER_SECRET: "b".repeat(64), LOG_LEVEL: "error" }),
      store,
      identity,
      keyWrapper: spy,
      port: 0,
    });
    running.push(agent);

    const res = await agent.app.request("/providers/openrouter/key", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "sk-test-injected-wrapper" }),
    });

    expect(res.status).toBe(200);
    expect(spy.wrap).toHaveBeenCalled();
    const row = await store.forUser(ALICE.id).credentials.read("openrouter");
    expect(row?.keyVersion).toBe(wrapper.currentVersion);
    expect(row?.ciphertext.toString("utf8")).not.toContain("sk-test-injected-wrapper");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_CAPABILITIES, type Principal } from "../../src/identity/types.js";
import { ProviderHub } from "../../src/providers/hub.js";
import { hubFactory } from "../../src/providers/hubFactory.js";
import { wrapper } from "../fixtures/app.js";
import { fakeFetch } from "../fixtures/fakeFetch.js";
import { MemoryDb } from "../fixtures/memoryRepos.js";
import { GATEWAY } from "../fixtures/privateUrls.js";
import { ALICE, ALL_CAPABILITIES } from "../fixtures/users.js";

afterEach(() => vi.restoreAllMocks());

function build(user: Principal) {
  const create = vi.spyOn(ProviderHub, "create");
  const db = new MemoryDb();
  const f = fakeFetch([]);
  const factory = hubFactory({ repos: (id) => db.forUser(id), keyWrapper: wrapper, gateway: GATEWAY, network: { fetch: f, userFetch: f } });
  return factory(user).then((hub) => ({ hub, options: create.mock.calls[0][0] }));
}

describe("hubFactory", () => {
  it("passes the principal's capabilities and no gateway without operatorGateway", async () => {
    const { options } = await build({ ...ALICE, capabilities: { ...ALL_CAPABILITIES, operatorGateway: false } });
    expect(options.capabilities).toMatchObject({ privateNetworkModels: true, operatorGateway: false });
    expect(options).not.toHaveProperty("litellm");
  });

  it("passes no gateway to a principal with no capabilities", async () => {
    const { hub, options } = await build(ALICE);
    expect(options.capabilities).toBe(NO_CAPABILITIES);
    expect(options).not.toHaveProperty("litellm");
    expect(hub.list().some((p) => p.id === "litellm")).toBe(false);
  });

  it("passes the gateway with operatorGateway", async () => {
    const { hub, options } = await build({ ...ALICE, capabilities: { ...NO_CAPABILITIES, operatorGateway: true } });
    expect(options.litellm).toEqual(GATEWAY);
    expect(hub.list().some((p) => p.id === "litellm")).toBe(true);
  });
});

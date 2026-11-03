import { afterEach, describe, expect, it, vi } from "vitest";
import { providersApi } from "../../src/lib/providers.ts";

const ok = () =>
  new Response(JSON.stringify({ flow: "f1", models: [], providers: [] }), { headers: { "content-type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
});

function urls(run: () => Promise<unknown>) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => ok());
  vi.stubGlobal("fetch", fetch);
  return run().then(() => fetch.mock.calls.map(([url]) => String(url)));
}

describe("providersApi paths", () => {
  it("keeps plain provider and flow ids unchanged", async () => {
    expect(await urls(() => providersApi.saveKey("openai", "k"))).toEqual(["/api/providers/openai/key"]);
    expect(await urls(() => providersApi.loginState("f1"))).toEqual(["/api/providers/logins/f1"]);
  });

  it("encodes provider ids so they stay one path segment", async () => {
    const id = "a/b?x=1#y";
    const enc = "a%2Fb%3Fx%3D1%23y";
    expect(await urls(() => providersApi.saveKey(id, "k"))).toEqual([`/api/providers/${enc}/key`]);
    expect(await urls(() => providersApi.remove(id))).toEqual([`/api/providers/${enc}`]);
    expect(await urls(() => providersApi.models(id))).toEqual([`/api/providers/${enc}/models`]);
    expect(await urls(() => providersApi.setEnabled(id, []))).toEqual([`/api/providers/${enc}/models`]);
    expect(await urls(() => providersApi.startLogin(id))).toEqual([`/api/providers/${enc}/login`]);
  });

  it("encodes flow ids so they stay one path segment", async () => {
    const flow = "../admin?x";
    const enc = "..%2Fadmin%3Fx";
    expect(await urls(() => providersApi.loginState(flow))).toEqual([`/api/providers/logins/${enc}`]);
    expect(await urls(() => providersApi.answerLogin(flow, "v"))).toEqual([`/api/providers/logins/${enc}/answer`]);
    expect(await urls(() => providersApi.cancelLogin(flow))).toEqual([`/api/providers/logins/${enc}`]);
  });

  it("refuses ids that are dot segments", async () => {
    await expect(urls(() => providersApi.remove(".."))).rejects.toThrow(TypeError);
    await expect(urls(() => providersApi.loginState("."))).rejects.toThrow(TypeError);
  });
});

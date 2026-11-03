import net from "node:net";
import { type Dispatcher, getGlobalDispatcher, MockAgent, setGlobalDispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALICE } from "../fixtures/users.js";
import { copilotHarness, Deferred, fakeRun, parseSse, post, RUN, readUntil, runBody, STOP, T1 } from "./harness.js";

let previous: Dispatcher;
let mock: MockAgent;
const outbound: string[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  outbound.length = 0;
  previous = getGlobalDispatcher();
  mock = new MockAgent();
  mock.disableNetConnect();
  setGlobalDispatcher(mock);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      outbound.push(url);
      throw new Error(`outbound request refused in this test: ${url}`);
    }),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  setGlobalDispatcher(previous);
  await mock.close();
  expect(globalThis.fetch).toBe(realFetch);
});

describe("the copilot runtime in the agent", () => {
  it("makes no outbound network call for info, a run and a stop", async () => {
    const connects = vi.spyOn(net.Socket.prototype, "connect");
    const holds = new Map([[T1, new Deferred()]]);
    const h = await copilotHarness({ handle: fakeRun({ holds }) });
    const info = await h.call(ALICE, "/copilotkit/info");
    expect(info.status).toBe(200);
    expect(await info.json()).toMatchObject({ telemetryDisabled: true });
    const reader = (await post(h, ALICE, RUN, runBody(T1))).body!.getReader();
    await readUntil(reader, (t) => t.includes("Hello"));
    const stop = await post(h, ALICE, STOP(T1), {});
    expect(await stop.json()).toMatchObject({ stopped: true });
    expect(parseSse(await readUntil(reader, () => false)).at(-1)).toMatchObject({ code: "abort" });
    holds.get(T1)!.resolve();
    await new Promise((r) => setTimeout(r, 50));
    expect(outbound).toEqual([]);
    expect(connects).not.toHaveBeenCalled();
    mock.assertNoPendingInterceptors();
    connects.mockRestore();
  });
});

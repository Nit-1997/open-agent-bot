import type { RunAgentInput } from "@ag-ui/core";
import { afterEach, describe, expect, it } from "vitest";
import type { RunContext } from "../../src/agui/runHandler.js";
import { ALICE, BOB } from "../fixtures/users.js";
import {
  CONNECT,
  copilotHarness,
  Deferred,
  finished,
  type Handle,
  parseSse,
  post,
  RUN,
  readUntil,
  runBody,
  STOP,
  started,
  T1,
  T2,
  text,
  textEnd,
  textStart,
  waitFor,
} from "./harness.js";

const gates: Deferred[] = [];

function deferredClaim(gate: Deferred, claimed: string[]): Handle {
  return async function* (input: RunAgentInput, ctx: RunContext) {
    yield started(input);
    await gate.promise;
    await ctx.chats.claim(input.threadId, {});
    claimed.push(input.threadId);
    yield textStart("m1");
    yield text("m1", "Hello");
    yield textEnd("m1");
    yield finished(input);
  } as Handle;
}

afterEach(() => {
  for (const g of gates.splice(0)) g.resolve();
});

describe("the window between RUN_STARTED and the claim", () => {
  it("lets the owner stop the run and refuses everyone else", async () => {
    const gate = new Deferred();
    gates.push(gate);
    const claimed: string[] = [];
    const h = await copilotHarness({ handle: deferredClaim(gate, claimed) });
    const reader = (await post(h, ALICE, RUN, runBody(T1))).body!.getReader();
    await readUntil(reader, (t) => t.includes("RUN_STARTED"));
    expect(h.owners.ownerOf(T1)).toBeUndefined();
    expect(await h.db.forUser(ALICE.id).chats.exists(T1)).toBe(false);

    for (const [path, body] of [
      [STOP(T1), {}],
      [CONNECT, runBody(T1)],
    ] as const) {
      const res = await post(h, BOB, path, body);
      expect(res.status, path).toBe(403);
      expect(await res.json()).toMatchObject({ error: "forbidden" });
    }

    const stop = await post(h, ALICE, STOP(T1), {});
    expect(stop.status).toBe(200);
    expect(await stop.json()).toMatchObject({ stopped: true });
    expect(parseSse(await readUntil(reader, () => false)).at(-1)).toMatchObject({ type: "RUN_ERROR", code: "abort" });
    expect(claimed).toEqual([]);
  });

  it("records the owner once the deferred claim resolves for a fresh run", async () => {
    const gate = new Deferred();
    gates.push(gate);
    const claimed: string[] = [];
    const h = await copilotHarness({ handle: deferredClaim(gate, claimed) });
    const reader = (await post(h, ALICE, RUN, runBody(T2))).body!.getReader();
    await readUntil(reader, (t) => t.includes("RUN_STARTED"));
    expect(h.owners.ownerOf(T2)).toBeUndefined();
    gate.resolve();
    expect(await readUntil(reader, () => false)).toContain("RUN_FINISHED");
    await waitFor(() => claimed.length === 1);
    expect(h.owners.ownerOf(T2)).toBe(ALICE.id);
    expect((await post(h, BOB, STOP(T2), {})).status).toBe(403);
  });
});

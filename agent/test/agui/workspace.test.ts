import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BaseEvent, EventType, type RunAgentInput } from "@ag-ui/core";
import { afterEach, describe, expect, it } from "vitest";
import { handleRun, readCartEdits, readWorkspaceEdits, restoreHistory, SESSION_EXPIRED_MESSAGE } from "../../src/agui/runHandler.js";
import { type HistoryMessage, type SessionEntry, SessionStore } from "../../src/session/sessionStore.js";
import { workspaceCart, workspaceNote } from "../../src/workspace/cart.js";
import { parseWorkspaceEdits } from "../../src/workspace/edits.js";
import { WorkspaceStore } from "../../src/workspace/store.js";
import { Evidence } from "../../src/grounding/evidence.js";
import { ev, fakeSession, type Script } from "./fakeSession.js";

const say: Script = async (emit) => {
  emit(ev.assistantStart);
  emit(ev.delta("ok"));
  emit(ev.assistantEnd());
};

const open: WorkspaceStore[] = [];
afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

function setup() {
  const workspace = new WorkspaceStore(join(mkdtempSync(join(tmpdir(), "run-")), "w.sqlite"));
  open.push(workspace);
  const session = fakeSession(say);
  const created: { threadId: string; history?: HistoryMessage[] }[] = [];
  const store = new SessionStore({
    idleMs: 60000,
    create: async (threadId, _ctx, history): Promise<SessionEntry> => {
      created.push({ threadId, history });
      return { session, busy: false, lastUsed: 0, dispose: async () => {}, cart: workspaceCart(workspace, threadId) };
    },
  });
  return { workspace, store, session, created };
}

const msg = (id: string, role: string, content: string) => ({ id, role, content }) as never;

function input(over: Partial<RunAgentInput> = {}): RunAgentInput {
  return { threadId: "t1", runId: "r1", messages: [msg("m1", "user", "hello")], tools: [], context: [], state: {}, forwardedProps: {}, ...over } as RunAgentInput;
}

async function collect(it: AsyncIterable<BaseEvent>) {
  const out: BaseEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const party = { title: "8th birthday", guests: 12, date: "2026-11-14", budget: 300 };
const prior = [msg("m1", "user", "plan a party"), msg("m2", "assistant", "Here is the plan."), msg("m3", "tool", "ignored"), msg("m4", "user", "make it 16 kids")];

describe("session restore", () => {
  it("keeps SESSION_EXPIRED when the workspace flag is off", async () => {
    const { store } = setup();
    const out = await collect(handleRun(input({ messages: prior }), store, new AbortController().signal));
    expect(out.find((e) => e.type === EventType.RUN_ERROR)).toMatchObject({ code: "SESSION_EXPIRED", message: SESSION_EXPIRED_MESSAGE });
  });

  it("creates the session with the prior user and assistant text and prompts with the last message", async () => {
    const { store, workspace, session, created } = setup();
    const out = await collect(handleRun(input({ messages: prior }), store, new AbortController().signal, { workspace }));
    expect(out.map((e) => e.type)).toContain(EventType.RUN_FINISHED);
    expect(out.some((e) => e.type === EventType.RUN_ERROR)).toBe(false);
    expect(created).toEqual([{ threadId: "t1", history: [{ role: "user", text: "plan a party" }, { role: "assistant", text: "Here is the plan." }] }]);
    expect(session.prompts).toEqual(["make it 16 kids"]);
  });

  it("brings the saved cart and entities back with the restored session", async () => {
    const { store, workspace } = setup();
    workspace.put("t1", "event", "main", party);
    const cart = workspaceCart(workspace, "t1");
    cart.start(["target"], [{ query: "pizza", qty: 3 }]);
    cart.save();
    await collect(handleRun(input({ messages: prior }), store, new AbortController().signal, { workspace }));
    expect(store.get("t1")?.cart?.items).toEqual([{ query: "pizza", qty: 3 }]);
    expect(workspaceNote(workspace, "t1")).toContain("12 guests");
  });

  it("counts the restored chat and the saved workspace as evidence, so their numbers aren't flagged", async () => {
    const workspace = new WorkspaceStore(join(mkdtempSync(join(tmpdir(), "run-")), "w.sqlite"));
    open.push(workspace);
    workspace.put("t1", "event", "main", party);
    const evidence = new Evidence();
    const store = new SessionStore({
      idleMs: 60000,
      create: async (): Promise<SessionEntry> => ({ session: fakeSession(say), busy: false, lastUsed: 0, dispose: async () => {}, evidence }),
    });
    const history = [msg("m1", "user", "plan a party"), msg("m2", "assistant", "The cart comes to $17.22."), msg("m4", "user", "how many guests now?")];
    await collect(handleRun(input({ messages: history }), store, new AbortController().signal, { workspace }));
    expect(evidence.unverified("It's for 12 guests, budget $300, and the cart is $17.22.")).toEqual([]);
  });

  it("does not seed history for a brand-new chat or an existing session", async () => {
    const { store, workspace, created } = setup();
    await collect(handleRun(input(), store, new AbortController().signal, { workspace }));
    await collect(handleRun(input({ messages: prior, runId: "r2" }), store, new AbortController().signal, { workspace }));
    expect(created).toEqual([{ threadId: "t1", history: undefined }]);
  });

  it("merges back-to-back same-role messages, clips and starts history on a user turn", () => {
    const history = restoreHistory([
      msg("a", "assistant", "stray"),
      msg("b", "user", "one"),
      msg("c", "user", "two"),
      msg("d", "assistant", ""),
      msg("e", "assistant", "x".repeat(5000)),
      msg("f", "user", "now"),
    ]);
    expect(history).toEqual([
      { role: "user", text: "one\n\ntwo" },
      { role: "assistant", text: "x".repeat(4000) },
    ]);
  });
});

describe("workspace_edits", () => {
  const ctx = (value: unknown, description = "workspace_edits") => [{ description, value: JSON.stringify(value) }];

  it("applies cart, event and trip edits before the turn and they show in the next summary", async () => {
    const { store, workspace, session } = setup();
    workspace.put("t1", "event", "main", party);
    workspace.put("t1", "trip", "main", { destination: "Tahoe", start: "2026-12-01", end: "2026-12-04", travelers: 2, stays: [], days: [] });
    const cart = workspaceCart(workspace, "t1");
    cart.start(["target"], [{ query: "pizza", qty: 3 }, { query: "cake", qty: 1 }]);
    cart.save();
    let seen: string | undefined;
    session.prompt = async () => {
      seen = workspaceNote(workspace, "t1");
    };
    await collect(handleRun(input({ context: ctx({ cart: { removed: ["cake"], qty: { pizza: 5 } }, event: { guests: 16, date: "2026-11-21", budget: 350 }, trip: { travelers: 3, end: "2026-12-05" } }) }), store, new AbortController().signal, { workspace }));
    expect(workspace.get("t1", "event", "main")).toMatchObject({ version: 2, value: { guests: 16, date: "2026-11-21", budget: 350, title: "8th birthday" } });
    expect(workspace.get("t1", "trip", "main")?.value).toMatchObject({ travelers: 3, end: "2026-12-05", start: "2026-12-01" });
    expect((workspace.get("t1", "cart", "main")!.value as { items: unknown }).items).toEqual([{ query: "pizza", qty: 5 }]);
    expect(seen).toContain("16 guests");
    expect(workspace.summary("t1")).toContain("event main: 8th birthday, 16 guests, 2026-11-21, budget $350");
  });

  it("still accepts cart_edits", async () => {
    const { store, workspace } = setup();
    const cart = workspaceCart(workspace, "t1");
    cart.start(["target"], [{ query: "pizza", qty: 3 }]);
    cart.save();
    await collect(handleRun(input({ context: ctx({ qty: { pizza: 7 } }, "cart_edits") }), store, new AbortController().signal, { workspace }));
    expect((workspace.get("t1", "cart", "main")!.value as { items: unknown }).items).toEqual([{ query: "pizza", qty: 7 }]);
  });

  it("ignores workspace_edits when the flag is off, as before", async () => {
    const { store, workspace } = setup();
    workspace.put("t1", "event", "main", party);
    await collect(handleRun(input({ context: ctx({ event: { guests: 16 } }) }), store, new AbortController().signal));
    expect(workspace.get("t1", "event", "main")?.version).toBe(1);
  });

  it("drops invalid fields and empty edits", () => {
    expect(parseWorkspaceEdits({ event: { guests: -2, date: "tomorrow", budget: "lots" }, trip: { travelers: 0 } })).toBeNull();
    expect(parseWorkspaceEdits({ event: { guests: 16.4, date: "2026-11-21T10:00", extra: 1 } })).toEqual({ event: { guests: 16, date: "2026-11-21T10:00" } });
    expect(parseWorkspaceEdits("nope")).toBeNull();
    expect(parseWorkspaceEdits({ cart: { removed: ["a", 3], qty: { a: 2 } } })).toEqual({ cart: { removed: ["a"], qty: { a: 2 }, picks: undefined } });
  });

  it("reads them from the AG-UI context, as a string or an object", () => {
    expect(readWorkspaceEdits(input({ context: ctx({ event: { guests: 9 } }) }))).toEqual({ event: { guests: 9 } });
    expect(readWorkspaceEdits(input({ context: [{ description: "workspace_edits", value: { trip: { start: "2026-12-01" } } as never }] }))).toEqual({ trip: { start: "2026-12-01" } });
    expect(readWorkspaceEdits(input({ context: [{ description: "workspace_edits", value: "{bad" }] }))).toBeNull();
    expect(readCartEdits(input({ context: ctx({ removed: ["x"] }, "cart_edits") }))).toMatchObject({ removed: ["x"] });
  });
});

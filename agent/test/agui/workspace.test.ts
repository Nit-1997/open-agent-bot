import { type BaseEvent, EventType, type RunAgentInput } from "@ag-ui/core";
import { describe, expect, it } from "vitest";
import { parseWorkspaceEdits } from "../../../shared/workspace.js";
import { historyFromStored, readWorkspaceEdits } from "../../src/agui/input.js";
import { handleRun, type RunContext } from "../../src/agui/runHandler.js";
import { Evidence } from "../../src/grounding/evidence.js";
import { type HistoryMessage, type SessionEntry, SessionStore } from "../../src/session/sessionStore.js";
import { workspaceCart, workspaceNote } from "../../src/workspace/cart.js";
import { MemoryWorkspaceStore, type WorkspaceStore } from "../../src/workspace/store.js";
import { MemoryDb } from "../fixtures/memoryRepos.js";
import { ALICE, CHAT_1 } from "../fixtures/users.js";
import { ev, fakeSession, type Script } from "./fakeSession.js";

const say: Script = async (emit) => {
  emit(ev.assistantStart);
  emit(ev.delta("ok"));
  emit(ev.assistantEnd());
};

const party = { title: "8th birthday", guests: 12, date: "2026-11-14", budget: 300 };

function setup(opts: { evidence?: Evidence } = {}) {
  const db = new MemoryDb();
  const workspace = new MemoryWorkspaceStore();
  const session = fakeSession(say);
  const created: { chatId: string; history?: HistoryMessage[] }[] = [];
  const store = new SessionStore({
    idleMs: 60000,
    create: async (owner, _ctx, history): Promise<SessionEntry> => {
      created.push({ chatId: owner.chatId, history });
      return { session, busy: false, lastUsed: 0, dispose: async () => {}, cart: await workspaceCart(workspace), evidence: opts.evidence };
    },
  });
  const repos = db.forUser(ALICE.id);
  const ctx: RunContext = { user: ALICE, chats: repos.chats, messages: repos.messages, workspace, timeLimitMs: 60_000 };
  const run = (inp: RunAgentInput) => collect(handleRun(inp, ctx, store, new AbortController().signal));
  return { db, repos, workspace, store, session, created, run };
}

const msg = (id: string, role: string, content: string) => ({ id, role, content }) as never;

function input(over: Partial<RunAgentInput> = {}): RunAgentInput {
  return {
    threadId: CHAT_1,
    runId: "r1",
    messages: [msg("m1", "user", "hello")],
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
    ...over,
  } as RunAgentInput;
}

async function collect(it: AsyncIterable<BaseEvent>) {
  const out: BaseEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const owner = { user: ALICE, chatId: CHAT_1 };

describe("session restore", () => {
  it("seeds a new session for an existing chat from the stored messages and prompts with the last message", async () => {
    const { repos, session, created, run } = setup();
    await repos.chats.claim(CHAT_1, {});
    await repos.messages.append(CHAT_1, "r0", [
      { role: "user", content: "plan a party", status: "complete" },
      { role: "assistant", content: "Here is the plan.", status: "complete" },
    ]);
    const out = await run(input({ messages: [msg("m4", "user", "make it 16 kids")] }));
    expect(out.map((e) => e.type)).toContain(EventType.RUN_FINISHED);
    expect(created).toEqual([
      {
        chatId: CHAT_1,
        history: [
          { role: "user", text: "plan a party" },
          { role: "assistant", text: "Here is the plan." },
        ],
      },
    ]);
    expect(session.prompts).toEqual(["make it 16 kids"]);
  });

  it("brings the saved cart and entities back with the restored session", async () => {
    const { store, workspace, run } = setup();
    await workspace.put("event", "main", party);
    const cart = await workspaceCart(workspace);
    cart.start(["target"], [{ query: "pizza", qty: 3 }]);
    cart.save();
    await new Promise((r) => setTimeout(r, 0));
    await run(input());
    expect(store.get(owner)?.cart?.items).toEqual([{ query: "pizza", qty: 3 }]);
    expect(await workspaceNote(workspace)).toContain("12 guests");
  });

  it("counts the restored chat and the saved workspace as evidence, so their numbers aren't flagged", async () => {
    const evidence = new Evidence();
    const { repos, workspace, run } = setup({ evidence });
    await workspace.put("event", "main", party);
    await repos.chats.claim(CHAT_1, {});
    await repos.messages.append(CHAT_1, "r0", [
      { role: "user", content: "plan a party", status: "complete" },
      { role: "assistant", content: "The cart comes to $17.22.", status: "complete" },
    ]);
    await run(input({ messages: [msg("m4", "user", "how many guests now?")] }));
    expect(evidence.unverified("It's for 12 guests, budget $300, and the cart is $17.22.")).toEqual([]);
  });

  it("does not seed history for a brand-new chat or an existing session", async () => {
    const { created, run } = setup();
    await run(input());
    await run(input({ runId: "r2" }));
    expect(created).toEqual([{ chatId: CHAT_1, history: undefined }]);
  });

  it("merges back-to-back same-role messages, clips and starts history on a user turn", () => {
    const history = historyFromStored([
      { role: "assistant", content: "stray" },
      { role: "user", content: "one" },
      { role: "user", content: "two" },
      { role: "assistant", content: "" },
      { role: "assistant", content: "x".repeat(5000) },
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
    const { workspace, session, run } = setup();
    await workspace.put("event", "main", party);
    await workspace.put("trip", "main", {
      destination: "Tahoe",
      start: "2026-12-01",
      end: "2026-12-04",
      travelers: 2,
      stays: [],
      days: [],
    });
    const cart = await workspaceCart(workspace);
    cart.start(
      ["target"],
      [
        { query: "pizza", qty: 3 },
        { query: "cake", qty: 1 },
      ],
    );
    cart.save();
    let seen: string | undefined;
    const ws: WorkspaceStore = workspace;
    session.prompt = async () => {
      await new Promise((r) => setTimeout(r, 0));
      seen = await workspaceNote(ws);
    };
    await run(
      input({
        context: ctx({
          cart: { removed: ["cake"], qty: { pizza: 5 } },
          event: { guests: 16, date: "2026-11-21", budget: 350 },
          trip: { travelers: 3, end: "2026-12-05" },
        }),
      }),
    );
    expect(await workspace.get("event", "main")).toMatchObject({
      version: 2,
      value: { guests: 16, date: "2026-11-21", budget: 350, title: "8th birthday" },
    });
    expect((await workspace.get("trip", "main"))?.value).toMatchObject({ travelers: 3, end: "2026-12-05", start: "2026-12-01" });
    expect(((await workspace.get("cart", "main"))!.value as { items: unknown }).items).toEqual([{ query: "pizza", qty: 5 }]);
    expect(seen).toContain("16 guests");
    expect(await workspace.summary()).toContain("event main: 8th birthday, 16 guests, 2026-11-21, budget $350");
  });

  it("drops invalid sections, strips unknown fields and returns null when nothing is left", () => {
    expect(parseWorkspaceEdits({ event: { guests: -2, date: "tomorrow", budget: "lots" }, trip: { travelers: 0 } })).toBeNull();
    expect(parseWorkspaceEdits({ event: { guests: 16, date: "2026-11-21T10:00", extra: 1 } })).toEqual({
      event: { guests: 16, date: "2026-11-21T10:00" },
    });
    expect(parseWorkspaceEdits({ event: { guests: 16.4 } })).toBeNull();
    expect(parseWorkspaceEdits("nope")).toBeNull();
    expect(parseWorkspaceEdits({ cart: { removed: ["a", 3], qty: { a: 2 } }, trip: { budget: 900 } })).toEqual({ trip: { budget: 900 } });
    expect(parseWorkspaceEdits({ cart: { picks: { target: null } } })).toBeNull();
    expect(parseWorkspaceEdits({ cart: { qty: { a: 2 } } })).toEqual({ cart: { qty: { a: 2 } } });
  });

  it("reads them from the AG-UI context, as a string or an object", () => {
    expect(readWorkspaceEdits(input({ context: ctx({ event: { guests: 9 } }) }))).toEqual({ event: { guests: 9 } });
    expect(
      readWorkspaceEdits(input({ context: [{ description: "workspace_edits", value: { trip: { start: "2026-12-01" } } as never }] })),
    ).toEqual({ trip: { start: "2026-12-01" } });
    expect(readWorkspaceEdits(input({ context: [{ description: "workspace_edits", value: "{bad" }] }))).toBeNull();
  });
});

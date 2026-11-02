import { type BaseEvent, EventType, type RunAgentInput } from "@ag-ui/core";
import { describe, expect, it } from "vitest";
import type { MessagePart } from "../../../shared/chats.js";
import { parseWorkspaceEdits } from "../../../shared/workspace.js";
import { historyFromStored, readWorkspaceEdits } from "../../src/agui/input.js";
import { handleRun, type RunContext } from "../../src/agui/runHandler.js";
import { Evidence } from "../../src/grounding/evidence.js";
import { sessionNote } from "../../src/session/createSession.js";
import { type SessionEntry, type SessionSeed, SessionStore } from "../../src/session/sessionStore.js";
import { workspaceCart } from "../../src/workspace/cart.js";
import { WorkspaceStore } from "../../src/workspace/store.js";
import { MemoryDb } from "../fixtures/memoryRepos.js";
import { ALICE, CHAT_1 } from "../fixtures/users.js";
import { ev, fakeSession, type Script } from "./fakeSession.js";

const say: Script = async (emit) => {
  emit(ev.assistantStart);
  emit(ev.delta("ok"));
  emit(ev.assistantEnd());
};

const party = { title: "8th birthday", guests: 12, date: "2026-11-14", budget: 300 };

const cartCard = {
  kind: "cart",
  stores: [
    {
      name: "Trader Joe's",
      total: 18.4,
      url: "https://www.traderjoes.com/",
      missing: [],
      items: [
        { query: "corn tortillas", qty: 2, picks: [] },
        { query: "avocados", qty: 6, picks: [] },
      ],
    },
  ],
};

const widgetPart = (id: string, widget: object): MessagePart => ({
  type: "tool",
  id: `${id}-widget`,
  name: "show_widget",
  args: JSON.stringify({ widget }),
});

function setup(opts: { evidence?: Evidence } = {}) {
  const db = new MemoryDb();
  const created: { chatId: string; seed?: SessionSeed }[] = [];
  const entries: SessionEntry[] = [];
  const notes: (string | undefined)[] = [];
  const session = fakeSession(say);
  const prompt = session.prompt;
  const store = new SessionStore({
    idleMs: 60000,
    create: async (owner, _ctx, _persona, seed): Promise<SessionEntry> => {
      created.push({ chatId: owner.chatId, seed });
      const workspace = new WorkspaceStore();
      const cart = workspaceCart(workspace);
      let edits: string | undefined;
      const entry: SessionEntry = {
        session,
        busy: false,
        lastUsed: 0,
        dispose: async () => {},
        cart,
        workspace,
        evidence: opts.evidence,
        setEditsNote: (n) => {
          edits = n;
        },
      };
      session.prompt = async (text: string) => {
        notes.push(await sessionNote({ workspace, cart, earlier: seed?.earlier, edits }));
        await prompt(text);
      };
      entries.push(entry);
      return entry;
    },
  });
  const repos = db.forUser(ALICE.id);
  const ctx: RunContext = { user: ALICE, chats: repos.chats, messages: repos.messages, timeLimitMs: 60_000 };
  const run = (inp: RunAgentInput) => collect(handleRun(inp, ctx, store, new AbortController().signal));
  return { db, repos, store, session, created, entries, notes, run };
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

const edits = (value: unknown) => [{ description: "workspace_edits", value: JSON.stringify(value) }];

describe("a new session for an existing chat", () => {
  it("is seeded from the stored messages and prompts with the last message", async () => {
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
        seed: {
          history: [
            { role: "user", text: "plan a party" },
            { role: "assistant", text: "Here is the plan." },
          ],
          earlier: { plans: [] },
        },
      },
    ]);
    expect(session.prompts).toEqual(["make it 16 kids"]);
  });

  it("gets the chat's last cart as a dated, read-only note and starts with an empty cart", async () => {
    const { db, repos, created, entries, notes, run } = setup();
    await repos.chats.claim(CHAT_1, {});
    await repos.messages.append(CHAT_1, "r0", [
      { role: "user", content: "taco night", status: "complete" },
      {
        role: "assistant",
        content: "Here's your cart.",
        status: "complete",
        parts: [widgetPart("t1", cartCard), { type: "text", text: "Here's your cart." }],
      },
    ]);
    const day = { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" } as const;
    const shown = new Intl.DateTimeFormat("en-US", day).format(new Date(db.messages.at(-1)!.createdAt));
    await run(input({ messages: [msg("m2", "user", "is that still the price?")] }));
    expect(created[0].seed?.earlier?.cart?.card.stores[0].name).toBe("Trader Joe's");
    expect(entries[0].cart?.empty).toBe(true);
    expect(notes[0]).toContain("<earlier_cards>");
    expect(notes[0]).toContain(`cart (shown ${shown} UTC): corn tortillas ×2, avocados ×6 at Trader Joe's; best $18.40 at Trader Joe's`);
  });

  it("gets the earlier-cards note even when the chat holds only cards", async () => {
    const { repos, created, run } = setup();
    await repos.chats.claim(CHAT_1, {});
    await repos.messages.append(CHAT_1, "r0", [
      { role: "assistant", content: "", status: "complete", parts: [widgetPart("t1", cartCard)] },
    ]);
    await run(input());
    expect(created[0].seed?.history).toBeUndefined();
    expect(created[0].seed?.earlier?.cart).toBeDefined();
  });

  it("counts the restored chat as evidence, so its numbers aren't flagged", async () => {
    const evidence = new Evidence();
    const { repos, run } = setup({ evidence });
    await repos.chats.claim(CHAT_1, {});
    await repos.messages.append(CHAT_1, "r0", [
      { role: "user", content: "plan a party", status: "complete" },
      { role: "assistant", content: "The cart comes to $17.22.", status: "complete" },
    ]);
    await run(input({ messages: [msg("m4", "user", "how much was it?")] }));
    expect(evidence.unverified("The cart was $17.22.")).toEqual([]);
  });

  it("is seeded for a brand-new chat with nothing in it, and an existing session gets no seed", async () => {
    const { created, run } = setup();
    await run(input());
    await run(input({ runId: "r2" }));
    expect(created).toEqual([{ chatId: CHAT_1, seed: { earlier: { plans: [] } } }]);
  });

  it("is seeded again after the user's sessions are retired", async () => {
    const { repos, store, created, run } = setup();
    await repos.chats.claim(CHAT_1, {});
    await repos.messages.append(CHAT_1, "r0", [
      { role: "assistant", content: "", status: "complete", parts: [widgetPart("t1", cartCard)] },
    ]);
    await run(input());
    await store.retireUser(ALICE.id);
    await run(input({ runId: "r2" }));
    expect(created).toHaveLength(2);
    expect(created[1].seed?.earlier?.cart).toBeDefined();
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

  it("stops showing the earlier cart once this session has had a cart, even after it is emptied", async () => {
    const { repos, entries, notes, run } = setup();
    await repos.chats.claim(CHAT_1, {});
    await repos.messages.append(CHAT_1, "r0", [
      { role: "assistant", content: "", status: "complete", parts: [widgetPart("t1", cartCard)] },
    ]);
    await run(input());
    expect(notes[0]).toContain("cart (shown");
    const cart = entries[0].cart!;
    cart.start(["target"], [{ query: "salsa", qty: 1 }]);
    cart.save();
    await run(input({ runId: "r2", context: edits({ cart: { removed: ["salsa"] } }) }));
    expect(cart.empty).toBe(true);
    expect(notes[1]).not.toContain("cart (shown");
    expect(notes[1]).not.toContain("<unapplied_edits>");
  });
});

describe("workspace_edits", () => {
  it("applies cart, event and trip edits to the session before the turn and they show in the note", async () => {
    const { store, entries, notes, run } = setup();
    await run(input({ runId: "r0" }));
    const { workspace, cart } = entries[0];
    await workspace.put("event", "main", party);
    await workspace.put("trip", "main", {
      destination: "Tahoe",
      start: "2026-12-01",
      end: "2026-12-04",
      travelers: 2,
      stays: [],
      days: [],
    });
    cart!.start(
      ["target"],
      [
        { query: "pizza", qty: 3 },
        { query: "cake", qty: 1 },
      ],
    );
    await run(
      input({
        context: edits({
          cart: { removed: ["cake"], qty: { pizza: 5 } },
          event: { guests: 16, date: "2026-11-21", budget: 350 },
          trip: { travelers: 3, end: "2026-12-05" },
        }),
      }),
    );
    expect(store.get({ user: ALICE, chatId: CHAT_1 })).toBe(entries[0]);
    expect(await workspace.get("event", "main")).toMatchObject({
      version: 2,
      value: { guests: 16, date: "2026-11-21", budget: 350, title: "8th birthday" },
    });
    expect((await workspace.get("trip", "main"))?.value).toMatchObject({ travelers: 3, end: "2026-12-05", start: "2026-12-01" });
    expect(cart!.items).toEqual([{ query: "pizza", qty: 5 }]);
    expect(notes.at(-1)).toContain("event main: 8th birthday, 16 guests, 2026-11-21, budget $350");
    expect(notes.at(-1)).not.toContain("<unapplied_edits>");
  });

  it("tells the model about cart edits a new session can't apply, for that turn only", async () => {
    const { notes, entries, run } = setup();
    await run(
      input({
        context: edits({
          cart: { qty: { avocados: 8 }, removed: ["black beans"], picks: { "Trader Joe's": { "corn tortillas": "Mission" } } },
        }),
      }),
    );
    expect(entries[0].cart?.empty).toBe(true);
    expect(notes[0]).toContain("<unapplied_edits>");
    expect(notes[0]).toContain('nothing was applied: avocados ×8; removed black beans; Trader Joe\'s corn tortillas → "Mission".');
    expect(notes[0]).toContain("If the user wants that cart, search again with these changes.");
    await run(input({ runId: "r2" }));
    expect(notes[1]).toBeUndefined();
  });

  it("tells the model about event edits when the session holds no event", async () => {
    const { notes, run } = setup();
    await run(input({ context: edits({ event: { guests: 16, date: "2026-11-20" } }) }));
    expect(notes[0]).toContain("guests 16, date 2026-11-20 on the event card");
    expect(notes[0]).toContain("If the user wants that plan, set it again with these changes.");
    expect(notes[0]).not.toContain("that cart");
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
    expect(readWorkspaceEdits(input({ context: edits({ event: { guests: 9 } }) }))).toEqual({ event: { guests: 9 } });
    expect(
      readWorkspaceEdits(input({ context: [{ description: "workspace_edits", value: { trip: { start: "2026-12-01" } } as never }] })),
    ).toEqual({ trip: { start: "2026-12-01" } });
    expect(readWorkspaceEdits(input({ context: [{ description: "workspace_edits", value: "{bad" }] }))).toBeNull();
  });
});

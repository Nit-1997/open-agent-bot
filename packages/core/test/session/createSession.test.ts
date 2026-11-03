import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT } from "@oab/shared/profile";
import { defaultModelRef, joinNotes, pickModel, sessionFactory } from "../../src/session/createSession.js";
import { WorkspaceStore } from "../../src/workspace/store.js";
import { testConfig } from "../fixtures/config.js";
import { ALICE, CHAT_1 } from "../fixtures/users.js";

const piOpts = vi.hoisted(() => [] as { contextNote?: () => Promise<string | undefined>; history?: unknown }[]);

vi.mock("../../src/pi/createPiSession.js", () => ({
  createPiSession: async (opts: (typeof piOpts)[number]) => {
    piOpts.push(opts);
    return { session: {}, setModel: async () => {}, dispose: async () => {} };
  },
}));

const model = (provider: string, id: string) => ({ provider, id }) as never;

function hub(models: Record<string, unknown>) {
  return { resolve: (ref: string) => models[ref] as never };
}

describe("pickModel", () => {
  const h = hub({ "openai/gpt": model("openai", "gpt"), "groq/x": model("groq", "x") });

  it("uses the chat's model when it resolves, else the model chosen in the profile", () => {
    expect(pickModel(h, "openai/gpt", "groq/x")).toEqual({ provider: "openai", id: "gpt" });
    expect(pickModel(h, "gone/model", "groq/x")).toEqual({ provider: "groq", id: "x" });
    expect(pickModel(h, undefined, "groq/x")).toEqual({ provider: "groq", id: "x" });
  });

  it("never guesses a model: with none chosen it says to pick one", () => {
    expect(() => pickModel(h, undefined, undefined)).toThrow("Pick a model in Settings → Models.");
    expect(() => pickModel(h, undefined, "removed/model")).toThrow("Pick a model in Settings → Models.");
  });
});

describe("defaultModelRef", () => {
  it("reports the profile's model only while it is still available", () => {
    const h = hub({ "groq/x": model("groq", "x") });
    expect(defaultModelRef(h, "groq/x")).toBe("groq/x");
    expect(defaultModelRef(h, "openai/gone")).toBeNull();
    expect(defaultModelRef(h, undefined)).toBeNull();
  });
});

describe("joinNotes", () => {
  it("joins the notes that are present with a blank line, in order", () => {
    expect(joinNotes("<workspace>a</workspace>", "<open_report>b</open_report>")).toBe(
      "<workspace>a</workspace>\n\n<open_report>b</open_report>",
    );
    expect(joinNotes(undefined, "<open_report>b</open_report>")).toBe("<open_report>b</open_report>");
    expect(joinNotes("<workspace>a</workspace>", undefined)).toBe("<workspace>a</workspace>");
    expect(joinNotes("", "x")).toBe("x");
  });

  it("gives undefined when no note is present, so no context message is added", () => {
    expect(joinNotes()).toBeUndefined();
    expect(joinNotes(undefined, undefined)).toBeUndefined();
    expect(joinNotes("", undefined)).toBeUndefined();
  });
});

describe("sessionFactory", () => {
  it("keeps the session's plans in a memory store on the entry and adds the earlier cards to the note", async () => {
    const m = model("openai", "gpt");
    const hub = { resolve: () => m, runtime: {}, secret: () => undefined };
    const create = sessionFactory({
      cfg: testConfig(),
      hubs: { get: async () => hub } as never,
      repos: () => ({}) as never,
      artifacts: { sink: () => ({}) } as never,
      pool: { close: async () => {} } as never,
      judgeFor: () => async () => ({ available: false }) as never,
    });
    const card = {
      kind: "plan",
      entity: "event",
      id: "main",
      version: 1,
      value: { title: "Party", guests: 12 },
    } as const;
    const ctx = { timeZone: "UTC", locale: "en-US", localTime: "2026-11-01T10:00", model: "openai/gpt" };
    const entry = await create({ user: ALICE, chatId: CHAT_1 }, ctx, DEFAULT_AGENT, {
      history: [{ role: "user", text: "plan a party" }],
      earlier: { plans: [{ at: "2026-11-01T10:00:00Z", card }] },
    });
    expect(entry.workspace).toBeInstanceOf(WorkspaceStore);
    expect(entry.cart?.empty).toBe(true);
    const opts = piOpts.at(-1)!;
    expect(opts.history).toEqual([{ role: "user", text: "plan a party" }]);
    expect(await opts.contextNote?.()).toContain("event main (shown Nov 1, 2026): Party, 12 guests");
    entry.setEditsNote?.("<unapplied_edits>x</unapplied_edits>");
    expect(await opts.contextNote?.()).toContain("<unapplied_edits>x</unapplied_edits>");
    await entry.workspace.put("event", "main", { title: "Party", guests: 16 });
    const note = await opts.contextNote?.();
    expect(note).toContain("<workspace>");
    expect(note).not.toContain("<earlier_cards>");
  });
});

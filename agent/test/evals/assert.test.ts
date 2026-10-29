import { describe, expect, it } from "vitest";
import { evaluate, evaluateAll } from "../../evals/assert.js";
import type { TurnRecord } from "../../evals/types.js";

const turn = (over: Partial<TurnRecord> = {}): TurnRecord => ({
  prompt: "p",
  tools: [],
  widgets: [],
  unverifiedClaims: 0,
  text: "",
  askedUser: false,
  durationMs: 1000,
  ...over,
});

const t1 = turn({
  tools: [
    { name: "stays", args: { city: "Paris", max_price: 400 }, result: "Hotel Marriott Opera 320 EUR" },
    { name: "ask_user", args: {}, result: "" },
  ],
  widgets: [{ kind: "stay_list", json: '{"kind":"stay_list","items":[{"nightly":"€320"}]}' }],
  text: "Top pick: Marriott for €320 a night.",
  unverifiedClaims: 1,
  durationMs: 30000,
});
const t2 = turn({ tools: [{ name: "shop", args: { items: [{ query: "pizza", qty: 16 }] }, result: "ok" }], text: "Done, I have booked it.", unverifiedClaims: 2, durationMs: 10000 });
const turns = [t1, t2];
const ok = (a: Parameters<typeof evaluate>[0], ts = turns) => evaluate(a, ts).ok;

describe("assertions", () => {
  it("must_call and must_not_call, whole scenario and scoped to a turn", () => {
    expect(ok({ type: "must_call", tool: "shop" })).toBe(true);
    expect(ok({ type: "must_call", tool: "shop", turn: 1 })).toBe(false);
    expect(ok({ type: "must_call", tool: "shop", turn: 2 })).toBe(true);
    expect(ok({ type: "must_not_call", tool: "browse" })).toBe(true);
    expect(ok({ type: "must_not_call", tool: "stays" })).toBe(false);
    expect(ok({ type: "must_not_call", tool: "stays", turn: 2 })).toBe(true);
  });

  it("max_tool_calls counts the scoped turns", () => {
    expect(ok({ type: "max_tool_calls", n: 3 })).toBe(true);
    expect(ok({ type: "max_tool_calls", n: 2 })).toBe(false);
    expect(ok({ type: "max_tool_calls", n: 1, turn: 2 })).toBe(true);
  });

  it("widget_present and widget_matches", () => {
    expect(ok({ type: "widget_present", kind: "stay_list" })).toBe(true);
    expect(ok({ type: "widget_present", kind: "cart" })).toBe(false);
    expect(ok({ type: "widget_matches", kind: "stay_list", pattern: "€|EUR" })).toBe(true);
    expect(ok({ type: "widget_matches", kind: "stay_list", pattern: "USD" })).toBe(false);
  });

  it("max_unverified_claims sums claims", () => {
    expect(ok({ type: "max_unverified_claims", n: 3 })).toBe(true);
    expect(ok({ type: "max_unverified_claims", n: 2 })).toBe(false);
    expect(ok({ type: "max_unverified_claims", n: 1, turn: 1 })).toBe(true);
  });

  it("banned_phrases is case-insensitive and reports the match", () => {
    const r = evaluate({ type: "banned_phrases", patterns: ["I (have )?booked", "nothing"] }, turns);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("have booked");
    expect(evaluate({ type: "banned_phrases", patterns: ["I (have )?booked"], turn: 1 }, turns).ok).toBe(true);
  });

  it("max_duration_s sums turn durations", () => {
    expect(ok({ type: "max_duration_s", n: 40 })).toBe(true);
    expect(ok({ type: "max_duration_s", n: 39 })).toBe(false);
  });

  it("text_matches, tool_arg_matches, tool_result_matches", () => {
    expect(ok({ type: "text_matches", pattern: "marriott" })).toBe(true);
    expect(ok({ type: "text_matches", pattern: "hyatt" })).toBe(false);
    expect(ok({ type: "tool_arg_matches", tool: "shop", pattern: "16", turn: 2 })).toBe(true);
    expect(ok({ type: "tool_arg_matches", tool: "shop", pattern: "16", turn: 1 })).toBe(false);
    expect(ok({ type: "tool_result_matches", tool: "stays", pattern: "Marriott|Hyatt" })).toBe(true);
    expect(ok({ type: "tool_result_matches", tool: "stays", pattern: "Hilton" })).toBe(false);
  });

  it("positive assertions fail when the scoped turn never happened", () => {
    expect(ok({ type: "must_call", tool: "shop", turn: 3 })).toBe(false);
    expect(ok({ type: "must_not_call", tool: "shop", turn: 3 })).toBe(true);
  });

  it("reports malformed or unknown assertions as failures instead of throwing", () => {
    expect(evaluate({ type: "must_call" }, turns)).toMatchObject({ ok: false, detail: expect.stringContaining("tool") });
    expect(evaluate({ type: "nope" }, turns).ok).toBe(false);
    expect(evaluate({ type: "text_matches", pattern: "(" }, turns).ok).toBe(false);
  });

  it("labels results so reports can name the failed assertion", () => {
    const [r] = evaluateAll([{ type: "tool_arg_matches", tool: "shop", pattern: "16", turn: 2 }], turns);
    expect(r.label).toBe("tool_arg_matches(tool=shop, pattern=16) @turn 2");
  });
});

import { describe, expect, it } from "vitest";
import { type RouteRow, summarize } from "../../evals/route.js";
import type { Route } from "../../src/agui/router.js";
import { AREAS } from "../../src/judge/criteria/routeAreas.js";

const row = (areas: RouteRow["areas"], intent: RouteRow["intent"] = "plan"): RouteRow => ({ split: "test", prompt: "p", areas, intent });
const route = (flagged: string[], intent: Route["intent"] = "plan", intentP = 0.95): Route => ({
  areas: Object.fromEntries(AREAS.map((a) => [a, flagged.includes(a) ? 0.9 : 0.1])) as Route["areas"],
  missingDetails: 0,
  intent,
  intentP,
  skills: [],
  tools: null,
});

describe("summarize", () => {
  it("computes recall, precision, full-coverage rate and hand-off errors", () => {
    const s = summarize([
      { row: row(["lodging", "flights"]), route: route(["lodging", "flights", "dining"]), ms: 100 },
      { row: row(["lodging", "flights"]), route: route(["lodging"]), ms: 300 },
      { row: row(["shopping"], "buy"), route: route(["shopping"], "buy"), ms: 200 },
      { row: row(["dining"]), route: route(["dining"], "book", 0.9), ms: 200 },
      { row: row(["dining"]), route: null, ms: 2500 },
    ]);
    expect(s.perArea.lodging).toEqual({ recall: 1, precision: 1 });
    expect(s.perArea.flights.recall).toBe(0.5);
    expect(s.perArea.dining.precision).toBe(0.5);
    expect(s.allFlagged).toBe(0.6);
    expect(s.failures).toBe(1);
    expect(s.handoffRecall).toBe(1);
    expect(s.falseHandoffs).toBe(1);
    expect(s.p50).toBe(200);
  });
});

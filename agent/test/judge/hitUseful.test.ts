import { describe, expect, it } from "vitest";
import { hitUseful, selectHits } from "../../src/judge/criteria/hitUseful.js";
import { type Judge, noJudge } from "../../src/judge/index.js";

const hits = ["a", "b", "c", "d", "e"].map((x) => ({ title: `Title ${x}`, snippet: `about ${x}`, url: `https://${x}.test/` }));

function fake(
  verdicts: Array<[boolean, number]> | null,
  seen: { state?: Record<string, unknown>; criteria?: unknown; shared?: unknown } = {},
): Judge {
  return {
    available: true,
    score: async () => null,
    choose: async () => null,
    usage: () => ({ calls: 0, failures: 0, costUsd: 0 }),
    yesno: async (items, c, o) => {
      seen.state = items[0].state;
      seen.criteria = c;
      seen.shared = o?.batch?.shared;
      return verdicts ? items.map((it, i) => ({ id: it.id, yes: verdicts[i][0], p: verdicts[i][1] })) : null;
    },
  };
}

describe("selectHits", () => {
  it("keeps the hits judged useful, most confident first, up to max", async () => {
    const seen: { state?: Record<string, unknown>; criteria?: unknown; shared?: unknown } = {};
    const out = await selectHits(
      fake(
        [
          [true, 0.7],
          [false, 0.1],
          [true, 0.95],
          [true, 0.8],
          [false, 0.3],
        ],
        seen,
      ),
      "heat pump cost?",
      hits,
      { max: 2 },
    );
    expect(out.map((h) => h.url)).toEqual(["https://c.test/", "https://d.test/"]);
    expect(seen.state).toEqual({ title: "Title a", snippet: "about a", url: "https://a.test/" });
    expect(seen.shared).toEqual({ question: "heat pump cost?" });
    expect(seen.criteria).toBe(hitUseful);
  });

  it("breaks ties by the original order", async () => {
    const out = await selectHits(fake(hits.map(() => [true, 0.8] as [boolean, number])), "q", hits, { max: 3 });
    expect(out.map((h) => h.title)).toEqual(["Title a", "Title b", "Title c"]);
  });

  it("falls back to the original order when the judge is missing, fails, or likes nothing", async () => {
    const original = hits.slice(0, 3).map((h) => h.url);
    expect((await selectHits(noJudge, "q", hits, { max: 3 })).map((h) => h.url)).toEqual(original);
    expect((await selectHits(fake(null), "q", hits, { max: 3 })).map((h) => h.url)).toEqual(original);
    expect((await selectHits(fake(hits.map(() => [false, 0.1] as [boolean, number])), "q", hits, { max: 3 })).map((h) => h.url)).toEqual(
      original,
    );
  });

  it("handles an empty list and hits without a snippet", async () => {
    expect(await selectHits(fake([]), "q", [], { max: 3 })).toEqual([]);
    const seen: { state?: Record<string, unknown> } = {};
    await selectHits(fake([[true, 0.9]], seen), "q", [{ title: "T", url: "https://x.test/" }], { max: 1 });
    expect(seen.state?.snippet).toBe("");
  });
});

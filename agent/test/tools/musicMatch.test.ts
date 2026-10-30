import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createJudge, type Judge } from "../../src/judge/index.js";
import { musicMatch } from "../../src/judge/criteria/musicMatch.js";
import { bestMatch, type ITunes, musicTool, pickMusic } from "../../src/tools/lookup.js";
import { fakeFetch, json } from "../fixtures/fakeFetch.js";

type Case = { query: string; kind: "album" | "song"; results: ITunes[]; accept: number[] };

const cases: Case[] = JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/music-match.json", import.meta.url)), "utf8"));

const correct = (c: Case, hit: ITunes | undefined) => (hit ? c.accept.includes(c.results.indexOf(hit)) : c.accept.length === 0);

async function score(pick: (c: Case) => Promise<ITunes | undefined>) {
  const wrong: string[] = [];
  let right = 0;
  for (const c of cases) {
    if (correct(c, await pick(c))) right++;
    else wrong.push(c.query);
  }
  return { right, total: cases.length, wrong };
}

const fakeJudge = (
  choice: string | null | "fail",
  seen: { state?: Record<string, unknown>; options?: Record<string, string> } = {},
): Judge => ({
  available: true,
  score: async () => null,
  yesno: async () => null,
  choose: async (state, options) => {
    seen.state = state;
    seen.options = options;
    return choice === "fail" ? null : { choice, p: 0.9 };
  },
  usage: () => ({ calls: 0, failures: 0, costUsd: 0 }),
});

describe("music match set", () => {
  it("has 20 titles with tributes, karaoke, covers, live versions and compilations among real iTunes candidates", () => {
    expect(cases).toHaveLength(20);
    const names = cases.flatMap((c) => c.results.map((r) => `${r.trackName ?? ""} ${r.collectionName} ${r.artistName}`)).join("\n");
    for (const word of [/karaoke/i, /tribute|lullaby|string quartet|symphonic/i, /\(Live/i, /greatest hits|essential|best of/i])
      expect(names).toMatch(word);
    expect(cases.some((c) => c.accept.length === 0)).toBe(true);
  });

  it("reports how today's word-overlap bestMatch does on it", async () => {
    const s = await score(async (c) => bestMatch(c.results, c.query, c.kind));
    console.log(`[music] bestMatch ${s.right}/${s.total} wrong: ${s.wrong.join("; ")}`);
    expect(s.right).toBeLessThan(s.total);
  });
});

describe("pickMusic", () => {
  const c = cases[0];

  it("takes the entry Jev chooses and describes every option", async () => {
    const seen: { state?: Record<string, unknown>; options?: Record<string, string> } = {};
    const hit = await pickMusic(c.results, c.query, c.kind, fakeJudge("c4", seen));
    expect(hit).toBe(c.results[4]);
    expect(seen.state).toEqual({ request: c.query, kind: "song" });
    expect(Object.keys(seen.options ?? {})).toHaveLength(c.results.length);
    expect(seen.options?.c0).toContain("Bohemian Rhapsody by Queen");
  });

  it("returns nothing when Jev says none of them is the work", async () => {
    expect(await pickMusic(c.results, c.query, c.kind, fakeJudge(null))).toBeUndefined();
  });

  it("falls back to word-overlap matching when the judge fails or is unavailable", async () => {
    const expected = bestMatch(c.results, c.query, c.kind);
    expect(await pickMusic(c.results, c.query, c.kind, fakeJudge("fail"))).toBe(expected);
    expect(await pickMusic(c.results, c.query, c.kind, { ...fakeJudge("c4"), available: false })).toBe(expected);
    expect(await pickMusic(c.results, c.query, c.kind)).toBe(expected);
  });

  it("scores a perfect fake judge at 100% on the set", async () => {
    const s = await score(async (k) => pickMusic(k.results, k.query, k.kind, fakeJudge(k.accept.length ? `c${k.accept[0]}` : null)));
    expect(s.right).toBe(20);
  });
});

describe("music tool with a judge", () => {
  const rows = cases[0].results;

  it("asks for ten candidates and shows the chosen one", async () => {
    const f = fakeFetch([[/itunes/, () => json({ results: rows })]]);
    const r = (await musicTool({ country: "US", fetch: f, judge: fakeJudge("c4") }).execute(
      "c",
      { queries: ["Bohemian Rhapsody Queen"], kind: "song" } as never,
      undefined,
      undefined,
      {} as never,
    )) as { content: Array<{ text: string }> };
    expect(new URL(f.calls[0]).searchParams.get("limit")).toBe("10");
    expect(r.content[0].text).toContain("Bohemian Rhapsody — Queen · A Night At The Opera · 1975");
  });

  it("keeps today's limit and matching with no judge, or an unavailable one", async () => {
    const f = fakeFetch([[/itunes/, () => json({ results: rows })]]);
    await musicTool({ country: "US", fetch: f, judge: { ...fakeJudge("c4"), available: false } }).execute(
      "c",
      { queries: ["x"], kind: "song" } as never,
      undefined,
      undefined,
      {} as never,
    );
    expect(new URL(f.calls[0]).searchParams.get("limit")).toBe("5");
  });
});

describe.skipIf(!process.env.OPENROUTER_API_KEY)("music match with live Jev", () => {
  it("picks the right work on at least 19 of 20", { timeout: 120000 }, async () => {
    const runtime = await ModelRuntime.create({
      authPath: join(mkdtempSync(join(tmpdir(), "music-")), "auth.json"),
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    const judge = await createJudge({
      runtime,
      model: process.env.JEV_MODEL ?? "openrouter/typesafe/jev-1.14",
      log: () => {},
      timeoutMs: 15000,
    });
    expect(judge.available).toBe(true);
    const s = await score((c) => pickMusic(c.results, c.query, c.kind, judge));
    console.log(
      `[music] ${musicMatch.id}@${musicMatch.version} jev ${s.right}/${s.total} wrong: ${s.wrong.join("; ")} cost $${judge.usage().costUsd.toFixed(5)} calls ${judge.usage().calls}`,
    );
    expect(s.right).toBeGreaterThanOrEqual(19);
  });
});

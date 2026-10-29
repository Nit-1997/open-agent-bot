import type { Judge, YesNoCriteria } from "../index.js";

export type Hit = { title: string; snippet?: string; url: string };

export const hitUseful: YesNoCriteria = {
  id: "hitUseful",
  version: "1",
  question: "Someone is researching the question. Is this search result likely to contain information that helps answer it?",
  yes: "The title or snippet is about the subject of the question and looks like a page with facts, data, or specifics that answer it, from a source that would know.",
  no: "The result is about something else, only shares a keyword, is a login, product listing or navigation page, or is too thin to help.",
};

export async function selectHits<H extends Hit>(judge: Judge, question: string, hits: H[], opts: { max: number }): Promise<H[]> {
  const fallback = hits.slice(0, opts.max);
  if (!judge.available || hits.length === 0) return fallback;
  const verdicts = await judge.yesno(
    hits.map((h, i) => ({ id: String(i), state: { title: h.title, snippet: h.snippet ?? "", url: h.url } })),
    hitUseful,
    { batch: { shared: { question } } },
  );
  if (!verdicts) return fallback;
  const useful = verdicts
    .map((v, i) => ({ hit: hits[i], yes: v.yes, p: v.p, i }))
    .filter((v) => v.yes)
    .sort((a, b) => b.p - a.p || a.i - b.i)
    .slice(0, opts.max)
    .map((v) => v.hit);
  return useful.length ? useful : fallback;
}

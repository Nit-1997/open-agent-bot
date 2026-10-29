import { claimSupported } from "../judge/criteria/claimSupported.js";
import type { Judge } from "../judge/index.js";

export type SourceDoc = { url: string; text: string };
export type Verdict = "supported" | "unsupported" | "unchecked";
export type ClaimResult = { text: string; url: string; verdict: Verdict };
export type VerifyOutcome = { html: string; claims: ClaimResult[]; total: number; supported: number; flagged: number; removed: number; unchecked: number };

const UNIT = /<(p|li|td|figcaption|blockquote)\b[^>]*>([\s\S]*?)<\/\1>|<div class="stat">([\s\S]*?)<\/div>/gi;
const SOURCES_LIST = /<ol class="sources"[\s\S]*?<\/ol>/i;
const SPLIT = /(?<=[.!?])\s+(?=[A-Z"“])/;
const FIGURE = /\d[\d,]*\.\d|\d{2,}|[$€£]\d|\d\s?%/;
const BALANCED = ["a", "strong", "em", "b", "i", "span", "code", "small", "sup"];
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', nbsp: " ", apos: "'" };
const WORD = /[a-z0-9][a-z0-9.,%$]*/g;

export const SOURCE_CHARS = 8000;
const MAX_CLAIMS = 100;

const decode = (s: string) => s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, d, h, n) => (d ? String.fromCodePoint(Number(d)) : h ? String.fromCodePoint(Number.parseInt(h, 16)) : (ENTITIES[n.toLowerCase()] ?? m)));
const plain = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/gi)].map((m) => decode(m[1]));

function urlKey(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}`.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function balanced(html: string): boolean {
  return BALANCED.every((t) => (html.match(new RegExp(`<${t}\\b`, "gi")) ?? []).length === (html.match(new RegExp(`</${t}>`, "gi")) ?? []).length);
}

function sentences(inner: string): string[] {
  const parts = inner.split(SPLIT);
  const merged: string[] = [];
  for (const p of parts) {
    if (merged.length && plain(p).length < 4) merged[merged.length - 1] += ` ${p}`;
    else merged.push(p);
  }
  return merged.every(balanced) ? merged : [inner];
}

const isClaim = (text: string, urls: string[]) => text.length >= 4 && (urls.length > 0 || FIGURE.test(text));

type Piece = { html: string; claim?: { text: string; urls: string[] } };
type Unit = { start: number; end: number; open: string; close: string; tag: string; pieces: Piece[] };

function rowLabel(html: string, at: number): string {
  const row = html.lastIndexOf("<tr", at);
  if (row < 0) return "";
  const first = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/i.exec(html.slice(row, at));
  return first ? plain(first[1]) : "";
}

function units(html: string): Unit[] {
  const skip = SOURCES_LIST.exec(html);
  const out: Unit[] = [];
  for (const m of html.matchAll(UNIT)) {
    const start = m.index ?? 0;
    if (skip && start >= skip.index && start < skip.index + skip[0].length) continue;
    const inner = m[2] ?? m[3] ?? "";
    const open = m[0].slice(0, m[0].indexOf(inner));
    const close = m[0].slice(open.length + inner.length);
    const label = m[1]?.toLowerCase() === "td" ? rowLabel(html, start) : "";
    const cited = hrefs(inner);
    const parts = sentences(inner);
    const pieces = parts.map((p): Piece => {
      const text = plain(p);
      const urls = hrefs(p).length ? hrefs(p) : parts.length === 1 ? cited : [];
      if (!isClaim(text, urls)) return { html: p };
      return { html: p, claim: { text: label && label !== text ? `${label}: ${text}` : text, urls } };
    });
    out.push({ start, end: start + m[0].length, open, close, tag: (m[1] ?? "div").toLowerCase(), pieces });
  }
  return out;
}

const tokens = (s: string) => new Set(s.toLowerCase().match(WORD)?.map((w) => w.replace(/[.,]+$/, "")) ?? []);

function pickSource(claim: { text: string; urls: string[] }, docs: { key: string; tokens: Set<string> }[]): number {
  const cited = docs.map((d, i) => (claim.urls.some((u) => urlKey(u) === d.key) ? i : -1)).filter((i) => i >= 0);
  const pool = cited.length ? cited : docs.map((_, i) => i);
  const want = [...tokens(claim.text)].filter((w) => w.length >= 3 || /\d/.test(w));
  const score = (i: number) => want.reduce((n, w) => n + (docs[i].tokens.has(w) ? (/\d/.test(w) ? 2 : 1) : 0), 0);
  return pool.reduce((best, i) => (score(i) > score(best) ? i : best), pool[0]);
}

const PROSE = new Set(["p", "li", "blockquote", "figcaption"]);

function listDrops(html: string, found: Unit[], keep: boolean[][]): Set<number> {
  const drops = new Set<number>();
  const lists = new Map<number, number[]>();
  for (const [ui, u] of found.entries()) {
    if (u.tag !== "li") continue;
    const open = Math.max(html.lastIndexOf("<ul", u.start), html.lastIndexOf("<ol", u.start));
    lists.set(open, [...(lists.get(open) ?? []), ui]);
  }
  for (const items of lists.values()) {
    const dead = items.filter((ui) => !keep[ui].some(Boolean));
    if (dead.length < items.length) for (const ui of dead) drops.add(ui);
  }
  return drops;
}

const mark = (html: string, verdict: Verdict) =>
  verdict === "unsupported"
    ? `<span class="unverified" title="Not supported by the cited source">${html}</span>`
    : verdict === "unchecked"
      ? `<span class="unchecked" title="Not checked against a source">${html}</span>`
      : html;

export async function verifyReport(html: string, sources: SourceDoc[], judge: Judge, opts: { signal?: AbortSignal; maxClaims?: number } = {}): Promise<VerifyOutcome> {
  const found = units(html);
  const docs = sources.map((s) => ({ key: urlKey(s.url), tokens: tokens(s.text.slice(0, SOURCE_CHARS)) }));
  const flat: { unit: number; piece: number; source: number; text: string; url: string }[] = [];
  for (const [ui, u] of found.entries()) {
    for (const [pi, p] of u.pieces.entries()) {
      if (!p.claim || !docs.length) continue;
      const source = pickSource(p.claim, docs);
      flat.push({ unit: ui, piece: pi, source, text: p.claim.text, url: sources[source].url });
    }
  }

  const verdicts = new Map<number, Verdict>();
  const bySource = new Map<number, number[]>();
  for (const [i, c] of flat.slice(0, opts.maxClaims ?? MAX_CLAIMS).entries()) bySource.set(c.source, [...(bySource.get(c.source) ?? []), i]);
  await Promise.all(
    [...bySource].map(async ([source, idx]) => {
      const text = sources[source].text.slice(0, SOURCE_CHARS);
      const items = idx.map((i) => ({ id: String(i), state: idx.length === 1 ? { claim: flat[i].text, source: text } : { claim: flat[i].text } }));
      const result = judge.available ? await judge.yesno(items, claimSupported, { signal: opts.signal, ...(idx.length > 1 && { batch: { shared: { source: text } } }) }).catch(() => null) : null;
      for (const [n, i] of idx.entries()) verdicts.set(i, result ? (result[n].yes ? "supported" : "unsupported") : "unchecked");
    }),
  );

  const marks = new Map<string, Verdict>();
  for (const [i, c] of flat.entries()) marks.set(`${c.unit}:${c.piece}`, verdicts.get(i) ?? "unchecked");
  const verdictOf = (ui: number, pi: number) => marks.get(`${ui}:${pi}`) ?? "supported";
  const keep = found.map((u, ui) => u.pieces.map((_, pi) => verdictOf(ui, pi) !== "unsupported"));
  const sentenceDrops = found.map((u, ui) => PROSE.has(u.tag) && keep[ui].some(Boolean));
  const dropItem = listDrops(html, found, keep);
  let removed = 0;
  let out = "";
  let at = 0;
  for (const [ui, u] of found.entries()) {
    out += html.slice(at, u.start);
    at = u.end;
    if (dropItem.has(ui)) {
      removed += u.pieces.filter((_, pi) => !keep[ui][pi]).length;
      continue;
    }
    const kept = u.pieces.flatMap((p, pi) => {
      if (keep[ui][pi] || !sentenceDrops[ui]) return [mark(p.html, verdictOf(ui, pi))];
      removed++;
      return [];
    });
    out += u.open + kept.join(" ") + u.close;
  }
  out += html.slice(at);

  const claims = flat.map((c, i): ClaimResult => ({ text: c.text, url: c.url, verdict: verdicts.get(i) ?? "unchecked" }));
  const count = (v: Verdict) => claims.filter((c) => c.verdict === v).length;
  return { html: out, claims, total: claims.length, supported: count("supported"), flagged: count("unsupported") - removed, removed, unchecked: count("unchecked") };
}

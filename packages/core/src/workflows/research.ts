import { REPORT_GUIDE } from "../artifacts/reportKit.js";
import { type Hit, selectHits } from "../judge/criteria/hitUseful.js";
import type { Judge } from "../judge/index.js";
import { mapLimit } from "../lib/concurrency.js";
import type { Complete } from "./llm.js";
import { SOURCE_CHARS, type SourceDoc, verifyReport } from "./verify.js";

export type Phase = "research" | "plan" | "implement" | "verify";
export type WorkflowStep = {
  workflow: "research";
  phase: Phase;
  status: "start" | "done";
  detail?: { sources?: number; supported?: number; total?: number; unchecked?: number };
};

type ResearchInput = { question: string; queries?: string[]; decision?: string; audience?: string };

export type ResearchDeps = {
  search: (query: string, signal?: AbortSignal) => Promise<Hit[]>;
  read: (url: string, signal?: AbortSignal) => Promise<string | null>;
  complete: Complete;
  judge: Judge;
  publish: (title: string, html: string) => Promise<{ id: string } | { error: string }>;
  emit: (step: WorkflowStep) => void;
  signal?: AbortSignal;
};

type ResearchOutcome =
  | {
      ok: true;
      id: string;
      title: string;
      takeaway: string;
      sources: number;
      supported: number;
      flagged: number;
      removed: number;
      unchecked: number;
      total: number;
    }
  | { ok: false; error: string };

const MAX_QUERIES = 4;
const MAX_CANDIDATES = 20;
const MAX_READS = 4;
const READ_PARALLEL = MAX_READS;
const MIN_PAGE_CHARS = 200;

type Plan = { title: string; decision: string; takeaway: string; outline: string[] };

const PLAN_SYSTEM = `You plan a research report. You get a question and the text of the sources that were read. Reply with only a JSON object: {"title": "...", "decision": "the decision or question the report answers, in one sentence", "takeaway": "the answer in one or two sentences, using only facts from the sources", "outline": ["section: what it covers and which source numbers back it", ...]}. Prefer facts the sources agree on, and say so when they disagree or don't cover something.`;

const IMPLEMENT_SYSTEM = `You write the report as one complete HTML page.

${REPORT_GUIDE}

Rules for facts:
- Every number, price, spec, rating, date, and comparison must come from the sources below. Never use outside knowledge for them. If the sources don't cover something, say it is not covered.
- Cite each such statement by linking its source in the same sentence, list item, or table cell: <a href="SOURCE URL">short source name</a>, using the exact source URLs given.
- One fact per sentence where you can; don't merge facts from different sources into one sentence.
- Pictures: only image URLs that appear in a source's images list.
- Keep it focused: about 700 words of text, the facts that decide the question, not everything the sources say.
- End with <ol class="sources"> listing the sources you used as links.
Reply with only the HTML.`;

const clip = (s: string) => s.slice(0, SOURCE_CHARS);

function sourcesText(docs: SourceDoc[]): string {
  return docs.map((d, i) => `[${i + 1}] ${d.url}\n${clip(d.text)}`).join("\n\n---\n\n");
}

function field(raw: string, key: string): string {
  const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(raw);
  if (!m) return "";
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return m[1];
  }
}

export function parsePlan(raw: string, question: string): Plan {
  const json = /\{[\s\S]*\}/.exec(raw)?.[0];
  try {
    const p = JSON.parse(json ?? "") as Partial<Plan>;
    return {
      title: String(p.title || question).slice(0, 120),
      decision: String(p.decision || question),
      takeaway: String(p.takeaway || ""),
      outline: Array.isArray(p.outline) ? p.outline.map(String) : [],
    };
  } catch {
    const title = field(raw, "title");
    if (title)
      return { title: title.slice(0, 120), decision: field(raw, "decision") || question, takeaway: field(raw, "takeaway"), outline: [] };
    return { title: question.slice(0, 120), decision: question, takeaway: "", outline: [raw.slice(0, 2000)] };
  }
}

function unfenced(raw: string): string {
  const m = /^```(?:html)?\s*\n([\s\S]*?)\n?```\s*$/i.exec(raw.trim());
  return (m ? m[1] : raw).trim();
}

async function gather(deps: ResearchDeps, input: ResearchInput): Promise<SourceDoc[]> {
  const queries = [...new Set((input.queries ?? []).map((q) => q.trim()).filter(Boolean))].slice(0, MAX_QUERIES);
  const lists = await Promise.all(
    (queries.length ? queries : [input.question]).map((q) => deps.search(q, deps.signal).catch(() => [] as Hit[])),
  );
  const seen = new Set<string>();
  const hits = lists
    .flat()
    .filter((h) => !seen.has(h.url) && !!seen.add(h.url))
    .slice(0, MAX_CANDIDATES);
  const chosen = await selectHits(deps.judge, input.question, hits, { max: MAX_READS });
  const pages = await mapLimit(chosen, READ_PARALLEL, async (h) => ({
    url: h.url,
    text: await deps.read(h.url, deps.signal).catch(() => null),
  }));
  return pages.filter((p): p is SourceDoc => !!p.text && p.text.length >= MIN_PAGE_CHARS);
}

export async function runResearch(input: ResearchInput, deps: ResearchDeps): Promise<ResearchOutcome> {
  const step = (phase: Phase, status: WorkflowStep["status"], detail?: WorkflowStep["detail"]) =>
    deps.emit({ workflow: "research", phase, status, ...(detail && { detail }) });
  try {
    step("research", "start");
    const docs = await gather(deps, input);
    if (!docs.length) return { ok: false, error: "no readable sources were found for that question" };
    step("research", "done", { sources: docs.length });

    step("plan", "start");
    const brief = [
      `Question: ${input.question}`,
      input.decision && `Decision to support: ${input.decision}`,
      input.audience && `Audience: ${input.audience}`,
    ]
      .filter(Boolean)
      .join("\n");
    const plan = parsePlan(
      await deps.complete({
        system: PLAN_SYSTEM,
        user: `${brief}\n\nSources:\n\n${sourcesText(docs)}`,
        maxTokens: 4000,
        signal: deps.signal,
      }),
      input.question,
    );
    step("plan", "done");

    step("implement", "start");
    const written = unfenced(
      await deps.complete({
        system: IMPLEMENT_SYSTEM,
        user: `${brief}\n\nTitle: ${plan.title}\nDecision: ${plan.decision}\nOutline:\n${plan.outline.map((o) => `- ${o}`).join("\n")}\n\nSources:\n\n${sourcesText(docs)}`,
        signal: deps.signal,
      }),
    );
    step("implement", "done");

    step("verify", "start");
    const checked = await verifyReport(
      written,
      docs.map((d) => ({ url: d.url, text: clip(d.text) })),
      deps.judge,
      { signal: deps.signal },
    );
    step("verify", "done", { supported: checked.supported, total: checked.total, unchecked: checked.unchecked });

    const saved = await deps.publish(plan.title, checked.html);
    if ("error" in saved) return { ok: false, error: saved.error };
    return {
      ok: true,
      id: saved.id,
      title: plan.title,
      takeaway: plan.takeaway,
      sources: docs.length,
      supported: checked.supported,
      flagged: checked.flagged,
      removed: checked.removed,
      unchecked: checked.unchecked,
      total: checked.total,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

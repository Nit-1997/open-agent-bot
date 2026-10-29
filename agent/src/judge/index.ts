import { createHash } from "node:crypto";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createLimiter } from "../lib/concurrency.js";

export type Level = { means: string; not: string };
export type ScoreCriteria<L extends string> = { id: string; version: string; question: string; levels: Record<L, Level> };
export type YesNoCriteria = { id: string; version: string; question: string; yes: string; no: string };
export type ChooseCriteria = { id: string; version: string; question: string };

export type Scored<L extends string> = { id: string; level: L; p: number; probabilities: Record<L, number> };

type Item = { id: string; state: Record<string, unknown> };
export type Usage = { calls: number; failures: number; costUsd: number };
type CallOpts = { signal?: AbortSignal; sink?: Usage };

export interface Judge {
  readonly available: boolean;
  score<L extends string>(items: Item[], c: ScoreCriteria<L>, o?: CallOpts): Promise<Scored<L>[] | null>;
  yesno(items: Item[], c: YesNoCriteria, o?: CallOpts): Promise<{ id: string; yes: boolean; p: number }[] | null>;
  choose(state: Record<string, unknown>, options: Record<string, string>, c: ChooseCriteria & { none?: string }, o?: CallOpts): Promise<{ choice: string | null; p: number } | null>;
  usage(): Usage;
}

type Runtime = Pick<ModelRuntime, "getAvailableOfType" | "classify">;
type Context = Parameters<Runtime["classify"]>[1];
type Question = Context["questions"][string];
type Answer = Awaited<ReturnType<Runtime["classify"]>>["answers"][string];
type Reply = { answer: Answer; tag: string; h: string; ms: number };

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_CONCURRENCY = 4;
const NONE = "none";
const Q = "q";

const unavailable = () => Promise.resolve(null);

export const noJudge: Judge = {
  available: false,
  score: unavailable,
  yesno: unavailable,
  choose: unavailable,
  usage: () => ({ calls: 0, failures: 0, costUsd: 0 }),
};

function splitModel(ref: string): { provider: string; id: string } | null {
  const i = ref.indexOf("/");
  return i > 0 && i < ref.length - 1 ? { provider: ref.slice(0, i), id: ref.slice(i + 1) } : null;
}

const hashOf = (state: unknown) => createHash("sha1").update(JSON.stringify(state)).digest("hex").slice(0, 8);
const round = (n: number) => Math.round(n * 100) / 100;

async function findModel(runtime: Runtime, ref: { provider: string; id: string }) {
  try {
    const found = await runtime.getAvailableOfType("classifier", ref.provider);
    return found.find((m) => m.id === ref.id && m.provider === ref.provider);
  } catch {
    return undefined;
  }
}

export async function createJudge(opts: { runtime: Runtime; model: string; timeoutMs?: number; concurrency?: number; log?: (line: string) => void }): Promise<Judge> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const ref = splitModel(opts.model);
  const model = ref ? await findModel(opts.runtime, ref) : undefined;
  if (!model) return noJudge;
  const classifier = model;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limit = createLimiter(opts.concurrency ?? DEFAULT_CONCURRENCY);
  const totals: Usage = { calls: 0, failures: 0, costUsd: 0 };

  async function ask(criteria: { id: string; version: string }, state: Record<string, unknown>, question: Question, o?: CallOpts): Promise<Reply | null> {
    const signal = o?.signal;
    const sinks = [totals, ...(o?.sink ? [o.sink] : [])];
    const tag = `${criteria.id}@${criteria.version}`;
    const h = hashOf(state);
    const started = Date.now();
    for (const u of sinks) u.calls++;
    const timer = new AbortController();
    const stop = setTimeout(() => timer.abort(new Error("timeout")), timeoutMs);
    const abort = signal ? AbortSignal.any([signal, timer.signal]) : timer.signal;
    const fail = (error: string) => {
      for (const u of sinks) u.failures++;
      log(`[jev] ${JSON.stringify({ c: tag, h, error })}`);
      return null;
    };
    try {
      if (abort.aborted) return fail("aborted");
      const aborted = new Promise<never>((_, reject) => {
        const onAbort = () => reject(abort.reason instanceof Error ? abort.reason : new Error("aborted"));
        if (abort.aborted) onAbort();
        else abort.addEventListener("abort", onAbort, { once: true });
      });
      const result = await Promise.race([opts.runtime.classify(classifier, { state: state as Context["state"], questions: { [Q]: question } }, { signal: abort }), aborted]);
      for (const u of sinks) u.costUsd += result.usage?.cost?.total ?? 0;
      if (result.stopReason !== "stop") return fail(result.errorMessage?.slice(0, 120) ?? result.stopReason);
      const answer = result.answers?.[Q];
      return answer ? { answer, tag, h, ms: Date.now() - started } : fail("no answer");
    } catch (err) {
      return fail(err instanceof Error ? err.message.slice(0, 120) : String(err));
    } finally {
      clearTimeout(stop);
    }
  }

  const note = (r: Reply, ans: string, p: number) => log(`[jev] ${JSON.stringify({ c: r.tag, h: r.h, ans, p: round(p), ms: r.ms })}`);
  const all = <T>(out: (T | null)[]) => (out.every((x) => x !== null) ? (out as T[]) : null);
  const chosen = (a: Answer) => (a.type === "choice" ? { choice: a.choice, p: a.probabilities?.[a.choice] ?? a.confidence ?? 0, probabilities: a.probabilities } : null);

  return {
    available: true,
    usage: () => ({ ...totals }),

    async score<L extends string>(items: Item[], c: ScoreCriteria<L>, o?: CallOpts) {
      const criteria = Object.fromEntries(Object.entries<Level>(c.levels).map(([k, v]) => [k, `${v.means} Not: ${v.not}`]));
      const question: Question = { type: "choice", instructions: c.question, criteria };
      const out = await Promise.all(items.map((item) => limit(async () => {
        const r = await ask(c, item.state, question, o);
        const pick = r && chosen(r.answer);
        if (!r || !pick || !(pick.choice in c.levels)) return null;
        note(r, pick.choice, pick.p);
        return { id: item.id, level: pick.choice as L, p: pick.p, probabilities: pick.probabilities as Record<L, number> };
      })));
      return all(out);
    },

    async yesno(items: Item[], c: YesNoCriteria, o?: CallOpts) {
      const question: Question = { type: "bool", instructions: c.question, criteria: { true: c.yes, false: c.no } };
      const out = await Promise.all(items.map((item) => limit(async () => {
        const r = await ask(c, item.state, question, o);
        if (r?.answer.type !== "bool") return null;
        const p = r.answer.probability;
        note(r, p >= 0.5 ? "yes" : "no", p);
        return { id: item.id, yes: p >= 0.5, p };
      })));
      return all(out);
    },

    async choose(state: Record<string, unknown>, options: Record<string, string>, c: ChooseCriteria & { none?: string }, o?: CallOpts) {
      const criteria = { ...options, ...(c.none && { [NONE]: c.none }) };
      const r = await limit(() => ask(c, state, { type: "choice", instructions: c.question, criteria }, o));
      const pick = r && chosen(r.answer);
      if (!r || !pick || !(pick.choice in criteria)) return null;
      note(r, pick.choice, pick.p);
      return { choice: pick.choice === NONE && c.none ? null : pick.choice, p: pick.p };
    },
  };
}

export function scopeJudge(base: Judge): Judge & { reset(): void } {
  let sink: Usage = { calls: 0, failures: 0, costUsd: 0 };
  return {
    get available() {
      return base.available;
    },
    score: (items, c, o) => base.score(items, c, { ...o, sink }),
    yesno: (items, c, o) => base.yesno(items, c, { ...o, sink }),
    choose: (state, options, c, o) => base.choose(state, options, c, { ...o, sink }),
    usage: () => ({ ...sink }),
    reset: () => {
      sink = { calls: 0, failures: 0, costUsd: 0 };
    },
  };
}

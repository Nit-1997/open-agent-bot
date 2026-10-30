import { createHash } from "node:crypto";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createLimiter } from "../lib/concurrency.js";
import { log as logger } from "../lib/log.js";

export type Level = { means: string; not: string };
export type ScoreCriteria<L extends string> = { id: string; version: string; question: string; levels: Record<L, Level> };
export type YesNoCriteria = { id: string; version: string; question: string; yes: string; no: string };
export type ChooseCriteria = { id: string; version: string; question: string };

export type MultiQuestion =
  | { type: "bool"; question: string; yes: string; no: string }
  | { type: "choice"; question: string; options: Record<string, string> };
export type MultiAnswer = { type: "bool"; yes: boolean; p: number } | { type: "choice"; choice: string; p: number };

export type Scored<L extends string> = { id: string; level: L; p: number; probabilities: Record<L, number> };

type Item = { id: string; state: Record<string, unknown> };
export type Usage = { calls: number; failures: number; costUsd: number };
type CallOpts = { signal?: AbortSignal; sink?: Usage; batch?: { shared: Record<string, unknown>; max?: number } };

export interface Judge {
  readonly available: boolean;
  score<L extends string>(items: Item[], c: ScoreCriteria<L>, o?: CallOpts): Promise<Scored<L>[] | null>;
  yesno(items: Item[], c: YesNoCriteria, o?: CallOpts): Promise<{ id: string; yes: boolean; p: number }[] | null>;
  choose(
    state: Record<string, unknown>,
    options: Record<string, string>,
    c: ChooseCriteria & { none?: string },
    o?: CallOpts,
  ): Promise<{ choice: string | null; p: number } | null>;
  classify(
    state: Record<string, unknown>,
    c: { id: string; version: string },
    questions: Record<string, MultiQuestion>,
    o?: CallOpts,
  ): Promise<Record<string, MultiAnswer> | null>;
  usage(): Usage;
}

type Runtime = Pick<ModelRuntime, "getAvailableOfType" | "classify">;
type Context = Parameters<Runtime["classify"]>[1];
type Question = Context["questions"][string];
type Answer = Awaited<ReturnType<Runtime["classify"]>>["answers"][string];
type Reply = { answers: Record<string, Answer>; tag: string; h: string; ms: number };

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_BATCH = 20;
const NONE = "none";
const Q = "q";

const unavailable = () => Promise.resolve(null);

export const noJudge: Judge = {
  available: false,
  score: unavailable,
  yesno: unavailable,
  choose: unavailable,
  classify: unavailable,
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

export async function createJudge(opts: {
  runtime: Runtime;
  model: string;
  timeoutMs?: number;
  concurrency?: number;
  log?: (line: string) => void;
}): Promise<Judge> {
  const log = opts.log ?? logger.debug;
  const ref = splitModel(opts.model);
  const model = ref ? await findModel(opts.runtime, ref) : undefined;
  if (!model) return noJudge;
  const classifier = model;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limit = createLimiter(opts.concurrency ?? DEFAULT_CONCURRENCY);
  const totals: Usage = { calls: 0, failures: 0, costUsd: 0 };

  async function ask(
    criteria: { id: string; version: string },
    state: Record<string, unknown>,
    questions: Record<string, Question>,
    o?: CallOpts,
  ): Promise<Reply | null> {
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
      const result = await Promise.race([
        opts.runtime.classify(classifier, { state: state as Context["state"], questions }, { signal: abort }),
        aborted,
      ]);
      for (const u of sinks) u.costUsd += result.usage?.cost?.total ?? 0;
      if (result.stopReason !== "stop") return fail(result.errorMessage?.slice(0, 120) ?? result.stopReason);
      return result.answers ? { answers: result.answers, tag, h, ms: Date.now() - started } : fail("no answer");
    } catch (err) {
      return fail(err instanceof Error ? err.message.slice(0, 120) : String(err));
    } finally {
      clearTimeout(stop);
    }
  }

  const one = async (criteria: { id: string; version: string }, state: Record<string, unknown>, question: Question, o?: CallOpts) => {
    const r = await ask(criteria, state, { [Q]: question }, o);
    const answer = r?.answers[Q];
    return r && answer ? { answer, tag: r.tag, h: r.h, ms: r.ms } : null;
  };

  const note = (r: { tag: string; h: string; ms: number }, ans: string, p: number) =>
    log(`[jev] ${JSON.stringify({ c: r.tag, h: r.h, ans, p: round(p), ms: r.ms })}`);
  const all = <T>(out: (T | null)[]) => (out.every((x) => x !== null) ? (out as T[]) : null);
  const chosen = (a: Answer) =>
    a.type === "choice" ? { choice: a.choice, p: a.probabilities?.[a.choice] ?? a.confidence ?? 0, probabilities: a.probabilities } : null;

  type Noted = { tag: string; h: string; ms: number };
  type YesNo = { id: string; yes: boolean; p: number };

  const toScored = <L extends string>(c: ScoreCriteria<L>, r: Noted, id: string, a: Answer | undefined): Scored<L> | null => {
    const pick = a && chosen(a);
    if (!pick || !(pick.choice in c.levels)) return null;
    note(r, pick.choice, pick.p);
    return { id, level: pick.choice as L, p: pick.p, probabilities: pick.probabilities as Record<L, number> };
  };

  const toYesNo = (r: Noted, id: string, a: Answer | undefined): YesNo | null => {
    if (a?.type !== "bool") return null;
    note(r, a.probability >= 0.5 ? "yes" : "no", a.probability);
    return { id, yes: a.probability >= 0.5, p: a.probability };
  };

  async function batched<T>(
    items: Item[],
    c: { id: string; version: string },
    o: CallOpts,
    question: (n: number) => Question,
    read: (r: Noted, id: string, a: Answer | undefined) => T | null,
  ): Promise<T[] | null> {
    const max = o.batch?.max ?? DEFAULT_BATCH;
    const groups: Item[][] = [];
    for (let i = 0; i < items.length; i += max) groups.push(items.slice(i, i + max));
    const parts = await Promise.all(
      groups.map((group) =>
        limit(async () => {
          const state = { ...o.batch?.shared, tiles: group.map((it, n) => ({ i: n, ...it.state })) };
          const questions = Object.fromEntries(group.map((_, n) => [`t${n}`, question(n)]));
          const r = await ask(c, state, questions, o);
          return r ? all(group.map((it, n) => read(r, it.id, r.answers[`t${n}`]))) : null;
        }),
      ),
    );
    const flat = all(parts);
    return flat ? flat.flat() : null;
  }

  async function oneByOne<T>(
    items: Item[],
    c: { id: string; version: string },
    question: Question,
    o: CallOpts | undefined,
    read: (r: Noted, id: string, a: Answer | undefined) => T | null,
  ): Promise<T[] | null> {
    const out = await Promise.all(
      items.map((item) =>
        limit(async () => {
          const r = await one(c, item.state, question, o);
          return r && read(r, item.id, r.answer);
        }),
      ),
    );
    return all(out);
  }

  return {
    available: true,
    usage: () => ({ ...totals }),

    async score<L extends string>(items: Item[], c: ScoreCriteria<L>, o?: CallOpts) {
      const criteria = Object.fromEntries(Object.entries<Level>(c.levels).map(([k, v]) => [k, `${v.means} Not: ${v.not}`]));
      const read = (r: Noted, id: string, a: Answer | undefined) => toScored(c, r, id, a);
      if (o?.batch && items.length > 1) {
        const instructions = (n: number) => `${c.question} Judge only the product with i=${n} in tiles.`;
        const out = await batched(items, c, o, (n) => ({ type: "choice", instructions: instructions(n), criteria }) as Question, read);
        if (out) return out;
      }
      return oneByOne(items, c, { type: "choice", instructions: c.question, criteria }, o, read);
    },

    async yesno(items: Item[], c: YesNoCriteria, o?: CallOpts) {
      const question: Question = { type: "bool", instructions: c.question, criteria: { true: c.yes, false: c.no } };
      if (o?.batch && items.length > 1) {
        const instructions = (n: number) => `${c.question} Judge only the item with i=${n} in tiles.`;
        const out = await batched(items, c, o, (n) => ({ ...question, instructions: instructions(n) }) as Question, toYesNo);
        if (out) return out;
      }
      return oneByOne(items, c, question, o, toYesNo);
    },

    async classify(
      state: Record<string, unknown>,
      c: { id: string; version: string },
      questions: Record<string, MultiQuestion>,
      o?: CallOpts,
    ) {
      const wire = Object.fromEntries(
        Object.entries(questions).map(([key, q]): [string, Question] => [
          key,
          q.type === "bool"
            ? { type: "bool", instructions: q.question, criteria: { true: q.yes, false: q.no } }
            : { type: "choice", instructions: q.question, criteria: q.options },
        ]),
      );
      const r = await limit(() => ask(c, state, wire, o));
      if (!r) return null;
      const out: Record<string, MultiAnswer> = {};
      for (const [key, q] of Object.entries(questions)) {
        const a = r.answers[key];
        if (q.type === "bool") {
          if (a?.type !== "bool") return null;
          out[key] = { type: "bool", yes: a.probability >= 0.5, p: a.probability };
        } else {
          const pick = a && chosen(a);
          if (!pick || !(pick.choice in q.options)) return null;
          out[key] = { type: "choice", choice: pick.choice, p: pick.p };
        }
      }
      log(
        `[jev] ${JSON.stringify({ c: r.tag, h: r.h, ans: Object.fromEntries(Object.entries(out).map(([k, a]) => [k, a.type === "bool" ? round(a.p) : `${a.choice}:${round(a.p)}`])), ms: r.ms })}`,
      );
      return out;
    },

    async choose(state: Record<string, unknown>, options: Record<string, string>, c: ChooseCriteria & { none?: string }, o?: CallOpts) {
      const criteria = { ...options, ...(c.none && { [NONE]: c.none }) };
      const r = await limit(() => one(c, state, { type: "choice", instructions: c.question, criteria }, o));
      const pick = r && chosen(r.answer);
      if (!r || !pick || !(pick.choice in criteria)) return null;
      note(r, pick.choice, pick.p);
      return { choice: pick.choice === NONE && c.none ? null : pick.choice, p: pick.p };
    },
  };
}

export async function createJudgeFrom(opts: {
  runtime: Runtime;
  models: string[];
  concurrency?: number;
}): Promise<Judge & { model?: string }> {
  for (const model of opts.models) {
    const judge = await createJudge({ runtime: opts.runtime, model, concurrency: opts.concurrency });
    if (judge.available) return Object.assign(judge, { model });
  }
  return noJudge;
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
    classify: (state, c, q, o) => base.classify(state, c, q, { ...o, sink }),
    usage: () => ({ ...sink }),
    reset: () => {
      sink = { calls: 0, failures: 0, costUsd: 0 };
    },
  };
}

const JUDGE_RETRY_MS = 30_000;

export function judgeResolver(
  create: () => Promise<Judge>,
  opts: { retryMs?: number; now?: () => number; log?: (line: string) => void } = {},
): () => Promise<Judge> {
  const retryMs = opts.retryMs ?? JUDGE_RETRY_MS;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? logger.info;
  let current: Judge | undefined;
  let checkedAt = Number.NEGATIVE_INFINITY;
  let pending: Promise<Judge> | undefined;
  return async () => {
    if (current?.available || now() - checkedAt < retryMs) return current ?? noJudge;
    pending ??= create()
      .catch(() => noJudge)
      .then((judge) => {
        if (judge.available !== current?.available) log(`[jev] available=${judge.available}`);
        current = judge;
        checkedAt = now();
        return judge;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}

import { type Static, type TSchema, Type } from "typebox";
import { Value } from "typebox/value";
import type { Db } from "../store/client.js";

export type UsageCaps = { perMonth: number; perHour: number };

export type AdmitResult =
  | { ok: true; monthUsed: number; hourUsed: number; logId: number }
  | { ok: false; reason: "month" | "hour"; monthUsed: number; hourUsed: number; retryAt: Date };

export type UsageNow = { monthUsed: number; hourUsed: number; hourRetryAt: Date | null };

export type UsageSummary = { monthTotal: number; activeUsers: number };

export type UsagePageQuery = { query?: string; atLeast?: number; limit: number; offset: number };

export type UsageRowDb = { userId: string; email: string; monthUsed: number; lastAt: string | null };

export interface UsageRepo {
  admit(userId: string): Promise<AdmitResult>;
  refund(userId: string, logId: number): Promise<void>;
  get(userId: string): Promise<UsageNow>;
  summary(): Promise<UsageSummary>;
  page(q: UsagePageQuery): Promise<{ total: number; items: UsageRowDb[] }>;
  lastRequest(userId: string): Promise<string | null>;
  prune(): Promise<void>;
  tombstone(userId: string): Promise<void>;
  humanCheck: { get(userId: string): Promise<boolean>; set(userId: string): Promise<void> };
}

export type UsageRepoOptions = { caps: UsageCaps; now?: () => Date; timeoutMs?: number };

export const USAGE_TIMEOUT_MS = 3000;

export class UsageRepoError extends Error {
  constructor(
    readonly where: string,
    readonly code: string | undefined,
  ) {
    super(`usage ${where} failed${code ? ` (${code})` : ""}`);
    this.name = "UsageRepoError";
  }
}

const AdmitRow = Type.Object({
  ok: Type.Boolean(),
  reason: Type.Union([Type.Literal("ok"), Type.Literal("month"), Type.Literal("hour")]),
  month_used: Type.Integer({ minimum: 0 }),
  hour_used: Type.Integer({ minimum: 0 }),
  retry_at: Type.Union([Type.String(), Type.Null()]),
  log_id: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
});

const GetRow = Type.Object({
  month_used: Type.Integer({ minimum: 0 }),
  hour_used: Type.Integer({ minimum: 0 }),
  hour_retry_at: Type.Union([Type.String(), Type.Null()]),
});

const SummaryRow = Type.Object({ month_total: Type.Integer({ minimum: 0 }), active_users: Type.Integer({ minimum: 0 }) });

const PageResult = Type.Object({
  total: Type.Integer({ minimum: 0 }),
  items: Type.Array(
    Type.Object({
      user_id: Type.String(),
      email: Type.String(),
      month_used: Type.Integer({ minimum: 1 }),
      last_at: Type.Union([Type.String(), Type.Null()]),
    }),
  ),
});

const LastRows = Type.Array(Type.Object({ last_at: Type.String() }), { maxItems: 1 });

const OneRow = <T extends TSchema>(row: T) => Type.Array(row, { minItems: 1, maxItems: 1 });

type RpcResult = { data: unknown; error: { code?: string | null } | null };

const date = (s: string) => {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new UsageRepoError("parse", "invalid_row");
  return d;
};

export function createUsageRepo(db: Db, opts: UsageRepoOptions): UsageRepo {
  const ms = opts.timeoutMs ?? USAGE_TIMEOUT_MS;
  const at = () => (opts.now ? { p_now: opts.now().toISOString() } : {});

  async function call<T extends TSchema>(where: string, schema: T, run: (signal: AbortSignal) => PromiseLike<RpcResult>) {
    const signal = AbortSignal.timeout(ms);
    let res: RpcResult;
    try {
      res = await run(signal);
    } catch {
      throw new UsageRepoError(where, signal.aborted ? "timeout" : "unreachable");
    }
    if (signal.aborted) throw new UsageRepoError(where, "timeout");
    if (res.error) throw new UsageRepoError(where, res.error.code || "unreachable");
    if (!Value.Check(schema, res.data)) throw new UsageRepoError(where, "invalid_row");
    return res.data as Static<T>;
  }

  return {
    async admit(userId) {
      const [r] = await call("admit", OneRow(AdmitRow), (s) =>
        db.rpc("request_admit", { p_user: userId, p_month_cap: opts.caps.perMonth, p_hour_cap: opts.caps.perHour, ...at() }).abortSignal(s),
      );
      if (r.ok && r.reason === "ok" && r.log_id !== null)
        return { ok: true, monthUsed: r.month_used, hourUsed: r.hour_used, logId: r.log_id };
      if (!r.ok && r.reason !== "ok" && r.retry_at !== null)
        return { ok: false, reason: r.reason, monthUsed: r.month_used, hourUsed: r.hour_used, retryAt: date(r.retry_at) };
      throw new UsageRepoError("admit", "invalid_row");
    },
    async refund(userId, logId) {
      await call("refund", Type.Boolean(), (s) => db.rpc("request_refund", { p_user: userId, p_log_id: logId }).abortSignal(s));
    },
    async get(userId) {
      const [r] = await call("get", OneRow(GetRow), (s) => db.rpc("request_usage_get", { p_user: userId, ...at() }).abortSignal(s));
      return { monthUsed: r.month_used, hourUsed: r.hour_used, hourRetryAt: r.hour_retry_at === null ? null : date(r.hour_retry_at) };
    },
    async summary() {
      const [r] = await call("summary", OneRow(SummaryRow), (s) => db.rpc("request_usage_summary", at()).abortSignal(s));
      return { monthTotal: r.month_total, activeUsers: r.active_users };
    },
    async page(q) {
      const r = await call("page", PageResult, (s) =>
        db
          .rpc("request_usage_page", {
            p_query: q.query ?? "",
            p_at_least: (q.atLeast ?? null) as number,
            p_limit: q.limit,
            p_offset: q.offset,
            ...at(),
          })
          .abortSignal(s),
      );
      return {
        total: r.total,
        items: r.items.map((i) => ({
          userId: i.user_id,
          email: i.email,
          monthUsed: i.month_used,
          lastAt: i.last_at && date(i.last_at).toISOString(),
        })),
      };
    },
    async lastRequest(userId) {
      const rows = await call("lastRequest", LastRows, (s) =>
        db
          .from("request_usage")
          .select("last_at")
          .eq("user_id", userId)
          .not("last_at", "is", null)
          .order("last_at", { ascending: false })
          .limit(1)
          .abortSignal(s),
      );
      return rows[0] ? date(rows[0].last_at).toISOString() : null;
    },
    async prune() {
      await call("prune", Type.Null(), (s) => db.rpc("request_log_prune", at()).abortSignal(s));
    },
    async tombstone(userId) {
      await call("tombstone", Type.Boolean(), (s) => db.rpc("usage_tombstone", { p_user: userId, ...at() }).abortSignal(s));
    },
    humanCheck: {
      async get(userId) {
        return call("humanCheck.get", Type.Boolean(), (s) => db.rpc("human_check_get", { p_user: userId }).abortSignal(s));
      },
      async set(userId) {
        await call("humanCheck.set", Type.Null(), (s) => db.rpc("human_check_set", { p_user: userId }).abortSignal(s));
      },
    },
  };
}

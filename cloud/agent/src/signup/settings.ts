import { log } from "@oab/core/lib/log.js";
import { SIGNUP_MODES, type SignupMode, type SignupStats } from "@oab/shared/usage";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { Db } from "../store/client.js";

export const SIGNUP_SETTINGS_TTL_MS = 60_000;
export const SIGNUP_TIMEOUT_MS = 3000;

export interface SignupSettings {
  mode(): Promise<SignupMode | "unknown">;
  stats(): Promise<SignupStats>;
}

export type SignupSettingsOptions = { now?: () => number; ttlMs?: number; timeoutMs?: number };

const ModeRows = Type.Array(Type.Object({ mode: Type.Union(SIGNUP_MODES.map((m) => Type.Literal(m))) }, { additionalProperties: true }), {
  minItems: 1,
  maxItems: 1,
});

const StatsRows = Type.Array(
  Type.Object({
    last_hour: Type.Integer({ minimum: 0 }),
    last_day: Type.Integer({ minimum: 0 }),
    cap_hour: Type.Integer({ minimum: 1 }),
    cap_day: Type.Integer({ minimum: 1 }),
  }),
  { minItems: 1, maxItems: 1 },
);

export class SignupLookupError extends Error {
  constructor(
    readonly where: string,
    readonly code: string,
  ) {
    super(`signup ${where} failed (${code})`);
    this.name = "SignupLookupError";
  }
}

type RpcResult = { data: unknown; error: { code?: string | null } | null };

async function rpc(where: string, ms: number, run: (signal: AbortSignal) => PromiseLike<RpcResult>): Promise<unknown> {
  const signal = AbortSignal.timeout(ms);
  let res: RpcResult;
  try {
    res = await run(signal);
  } catch {
    throw new SignupLookupError(where, signal.aborted ? "timeout" : "unreachable");
  }
  if (res.error) throw new SignupLookupError(where, res.error.code || "unreachable");
  return res.data;
}

export function createSignupSettings(db: Db, opts: SignupSettingsOptions = {}): SignupSettings {
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? SIGNUP_SETTINGS_TTL_MS;
  const ms = opts.timeoutMs ?? SIGNUP_TIMEOUT_MS;
  let cached: { mode: SignupMode; at: number } | undefined;
  let pending: Promise<SignupMode | "unknown"> | undefined;

  async function lookup(): Promise<SignupMode | "unknown"> {
    try {
      const data = await rpc("settings", ms, (s) => db.rpc("signup_settings_get").abortSignal(s));
      if (!Value.Check(ModeRows, data)) throw new SignupLookupError("settings", "invalid_row");
      const mode = data[0].mode as SignupMode;
      cached = { mode, at: now() };
      return mode;
    } catch (err) {
      log.warn("[signup] mode lookup failed, treating the mode as unknown", err instanceof Error ? err.message : err);
      return "unknown";
    }
  }

  return {
    mode() {
      if (cached && now() - cached.at < ttl) return Promise.resolve(cached.mode);
      pending ??= lookup().finally(() => {
        pending = undefined;
      });
      return pending;
    },
    async stats() {
      const data = await rpc("stats", ms, (s) => db.rpc("signup_stats").abortSignal(s));
      if (!Value.Check(StatsRows, data)) throw new SignupLookupError("stats", "invalid_row");
      const [r] = data;
      return { lastHour: r.last_hour, lastDay: r.last_day, capHour: r.cap_hour, capDay: r.cap_day };
    },
  };
}

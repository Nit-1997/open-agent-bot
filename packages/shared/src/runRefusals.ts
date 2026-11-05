export const RUN_REFUSAL_CODES = [
  "limit_running",
  "server_busy",
  "limit_hourly",
  "limit_attempts",
  "limit_monthly",
  "usage_unavailable",
  "human_check_required",
  "human_check_unavailable",
] as const;

export type RunRefusalCode = (typeof RUN_REFUSAL_CODES)[number];

export const RUN_REFUSAL_WINDOWS = ["running", "server", "hour", "attempts", "month"] as const;

export type RunRefusalWindow = (typeof RUN_REFUSAL_WINDOWS)[number];

export type RunRefusal = {
  code: RunRefusalCode;
  message: string;
  retryAfter?: number;
  retryAt?: string;
  limit?: number;
  used?: number;
  window?: RunRefusalWindow;
};

export const isRunRefusalCode = (v: unknown): v is RunRefusalCode =>
  typeof v === "string" && (RUN_REFUSAL_CODES as readonly string[]).includes(v);

const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined);

const instant = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : undefined);

const windowOf = (v: unknown) =>
  typeof v === "string" && (RUN_REFUSAL_WINDOWS as readonly string[]).includes(v) ? (v as RunRefusalWindow) : undefined;

export function parseRunRefusal(text: string): RunRefusal | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text.slice(start));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    body = parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (!isRunRefusalCode(body.error) || typeof body.message !== "string") return undefined;
  const retryAfter = count(body.retryAfter);
  const retryAt = instant(body.retryAt);
  const limit = count(body.limit);
  const used = count(body.used);
  const window = windowOf(body.window);
  return {
    code: body.error,
    message: body.message,
    ...(retryAfter !== undefined && { retryAfter }),
    ...(retryAt !== undefined && { retryAt }),
    ...(limit !== undefined && { limit }),
    ...(used !== undefined && { used }),
    ...(window !== undefined && { window }),
  };
}

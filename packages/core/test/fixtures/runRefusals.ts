import type { RunRefusalCode } from "@oab/shared/runRefusals";
import { UserError, type UserErrorKind } from "../../src/lib/errors.js";

type Sample = { status: number; kind: UserErrorKind; message: string; retryAfter?: number; details?: Record<string, string | number> };

const RETRY_AT = "2026-12-01T00:00:00.000Z";

export const REFUSAL_SAMPLES: Record<RunRefusalCode, Sample> = {
  limit_running: {
    status: 429,
    kind: "rate_limited",
    message: "You can run one chat at a time. Wait for the other one to finish or stop it.",
    retryAfter: 5,
    details: { retryAt: RETRY_AT, limit: 1, used: 1, window: "running" },
  },
  server_busy: {
    status: 429,
    kind: "rate_limited",
    message: "The demo server is at capacity right now. Try again in a minute.",
    retryAfter: 60,
    details: { retryAt: RETRY_AT, limit: 8, used: 8, window: "server" },
  },
  limit_hourly: {
    status: 429,
    kind: "rate_limited",
    message: "You're sending messages quickly. Try again in 40 seconds.",
    retryAfter: 40,
    details: { retryAt: RETRY_AT, limit: 10, used: 10, window: "hour" },
  },
  limit_attempts: {
    status: 429,
    kind: "rate_limited",
    message: "You're sending messages quickly. Try again in 12 seconds.",
    retryAfter: 12,
    details: { retryAt: RETRY_AT, limit: 60, window: "attempts" },
  },
  limit_monthly: {
    status: 429,
    kind: "rate_limited",
    message: "You've used this month's 50 requests.",
    retryAfter: 2330000,
    details: { retryAt: RETRY_AT, limit: 50, used: 50, window: "month" },
  },
  usage_unavailable: {
    status: 503,
    kind: "unavailable",
    message: "Can't check your usage right now. Try again in a minute.",
    retryAfter: 60,
    details: { retryAt: RETRY_AT },
  },
  human_check_required: { status: 403, kind: "forbidden", message: "Confirm you're human before your first message." },
  human_check_unavailable: {
    status: 503,
    kind: "unavailable",
    message: "Sign-up checks are unavailable right now. Try again in a minute.",
    retryAfter: 60,
    details: { retryAt: RETRY_AT },
  },
};

export const refusalError = (code: RunRefusalCode): UserError => {
  const s = REFUSAL_SAMPLES[code];
  return new UserError(s.message, s.kind, {
    code,
    ...(s.retryAfter !== undefined && { retryAfter: s.retryAfter }),
    ...(s.details && { details: s.details }),
  });
};

export const refusalBody = (code: RunRefusalCode) => {
  const s = REFUSAL_SAMPLES[code];
  return { error: code, message: s.message, ...(s.retryAfter !== undefined && { retryAfter: s.retryAfter }), ...s.details };
};

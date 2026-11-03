import { authErrorCopy } from "@/lib/authErrors";

export type ApiErrorBody = { error?: unknown; message?: unknown; retryAfter?: unknown; step?: unknown };

const DEFAULT_RETRY_SECONDS = 60;

export function apiErrorMessage(status: number, body: ApiErrorBody): string {
  if (status === 429) {
    const seconds = Number(body.retryAfter);
    return `Slow down: try again in ${Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : DEFAULT_RETRY_SECONDS} s.`;
  }
  const code = typeof body.error === "string" ? body.error : "";
  const message =
    typeof body.message === "string" && body.message ? body.message : authErrorCopy(code) || code || `Request failed (${status}).`;
  return typeof body.step === "string" ? `${message} (step: ${body.step})` : message;
}

export type RunErrorKind = "THREAD_BUSY" | "MODEL_ERROR" | "UNKNOWN";

const PATTERNS: Array<[RunErrorKind, RegExp]> = [
  ["THREAD_BUSY", /THREAD_BUSY|already running|thread[_ ]locked/i],
  ["MODEL_ERROR", /MODEL_ERROR/],
];

export function classifyRunError(event: { error: Error; context?: Record<string, unknown> }): RunErrorKind {
  let haystack = event.error?.message ?? "";
  try {
    haystack += ` ${JSON.stringify(event.context ?? {})}`;
  } catch {}
  return PATTERNS.find(([, re]) => re.test(haystack))?.[0] ?? "UNKNOWN";
}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const NOT_SAVED_EVENT = "not_saved";
const NOT_SAVED_FALLBACK = "This reply wasn't saved, so it won't be in this chat's history.";

export function notSavedMessage(value: unknown): string {
  const message = (value as { message?: unknown } | null)?.message;
  return typeof message === "string" && message.trim() ? message : NOT_SAVED_FALLBACK;
}

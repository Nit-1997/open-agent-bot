export type RunErrorKind = "SESSION_EXPIRED" | "THREAD_BUSY" | "MODEL_ERROR" | "UNKNOWN";

const PATTERNS: Array<[RunErrorKind, RegExp]> = [
  ["SESSION_EXPIRED", /SESSION_EXPIRED|session ended/i],
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

export type RunErrorKind = "SESSION_EXPIRED" | "THREAD_BUSY" | "MODEL_ERROR" | "UNKNOWN";

const KNOWN: RunErrorKind[] = ["SESSION_EXPIRED", "THREAD_BUSY", "MODEL_ERROR"];

export function classifyRunError(event: { error: Error; context?: Record<string, unknown> }): RunErrorKind {
  let haystack = event.error?.message ?? "";
  try {
    haystack += ` ${JSON.stringify(event.context ?? {})}`;
  } catch {}
  return KNOWN.find((k) => haystack.includes(k)) ?? "UNKNOWN";
}

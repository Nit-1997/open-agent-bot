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

export function errorCodeIn(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  try {
    const body = JSON.parse(text.slice(start)) as { error?: unknown };
    return typeof body.error === "string" ? body.error : undefined;
  } catch {
    return undefined;
  }
}

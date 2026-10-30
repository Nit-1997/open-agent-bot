const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 425, 429, 500, 502, 503, 504]);

type RetryOptions = {
  attempts: number;
  baseMs: number;
  maxDelayMs: number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  random: () => number;
  log: (line: string) => void;
};

export const abortableSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

const defaults: RetryOptions = {
  attempts: 4,
  baseMs: 400,
  maxDelayMs: 4000,
  sleep: abortableSleep,
  random: Math.random,
  log: (line) => console.log(line),
};

export function setRetryDefaults(overrides: Partial<RetryOptions>): void {
  Object.assign(defaults, overrides);
}

export function retryAfterMs(header: string | null, now: number = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

export function backoffMs(attempt: number, o: Pick<RetryOptions, "baseMs" | "maxDelayMs" | "random">): number {
  const window = Math.min(o.maxDelayMs, o.baseMs * 2 ** attempt);
  return Math.round(window / 2 + (o.random() * window) / 2);
}

const isAbort = (err: unknown) => err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
const hostOf = (input: string | URL | Request) => {
  try {
    return new URL(input instanceof Request ? input.url : input).host;
  } catch {
    return String(input);
  }
};

export function withRetry(f: typeof fetch, overrides: Partial<RetryOptions> = {}): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const o = { ...defaults, ...overrides };
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method !== "GET" && method !== "HEAD") return f(input, init);
    const signal = init?.signal ?? undefined;
    for (let attempt = 0; ; attempt++) {
      const last = attempt >= o.attempts - 1;
      let wait: number;
      try {
        const res = await f(input, init);
        if (last || !RETRYABLE_STATUSES.has(res.status)) return res;
        wait = Math.min(o.maxDelayMs, retryAfterMs(res.headers.get("retry-after")) ?? backoffMs(attempt, o));
        await res.body?.cancel().catch(() => {});
        o.log(`[retry] ${hostOf(input)} HTTP ${res.status}, attempt ${attempt + 2}/${o.attempts} in ${wait}ms`);
      } catch (err) {
        if (last || isAbort(err) || signal?.aborted) throw err;
        wait = backoffMs(attempt, o);
        o.log(`[retry] ${hostOf(input)} ${err instanceof Error ? err.message : String(err)}, attempt ${attempt + 2}/${o.attempts} in ${wait}ms`);
      }
      await o.sleep(wait, signal);
    }
  }) as typeof fetch;
}

export const retryingFetch: typeof fetch = withRetry((input, init) => fetch(input, init));

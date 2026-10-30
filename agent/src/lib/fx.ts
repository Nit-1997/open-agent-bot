import { timeoutSignal } from "../tools/net.js";
import { withRetry } from "./retry.js";

const BASE_URL = "https://api.frankfurter.app/latest";
const DAY_MS = 86_400_000;
const TIMEOUT_MS = 5000;

type Rates = { at: number; rates: Record<string, number> };
export type Fx = (from: string, to: string) => Promise<number | null>;
type Opts = { fetch?: typeof fetch; now?: () => number; timeoutMs?: number; log?: (line: string) => void };

export function createFx(opts: Opts = {}): Fx {
  const f = withRetry(opts.fetch ?? fetch);
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((line: string) => console.log(line));
  const cache = new Map<string, Rates>();
  const inflight = new Map<string, Promise<Rates | null>>();

  async function load(base: string): Promise<Rates | null> {
    const hit = cache.get(base);
    if (hit && now() - hit.at < DAY_MS) return hit;
    const pending = inflight.get(base);
    if (pending) return pending;
    const p = (async () => {
      try {
        const res = await f(`${BASE_URL}?from=${encodeURIComponent(base)}`, { signal: timeoutSignal(opts.timeoutMs ?? TIMEOUT_MS) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { rates?: Record<string, unknown> };
        const rates = Object.fromEntries(
          Object.entries(body.rates ?? {}).filter((e): e is [string, number] => typeof e[1] === "number" && e[1] > 0),
        );
        if (!Object.keys(rates).length) throw new Error("no rates");
        const loaded = { at: now(), rates };
        cache.set(base, loaded);
        return loaded;
      } catch (err) {
        log(`[fx] ${base} failed: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      } finally {
        inflight.delete(base);
      }
    })();
    inflight.set(base, p);
    return p;
  }

  return async (from, to) => {
    const a = from.trim().toUpperCase();
    const b = to.trim().toUpperCase();
    if (a === b) return 1;
    const loaded = await load(a);
    return loaded?.rates[b] ?? null;
  };
}

export const fx: Fx = createFx();

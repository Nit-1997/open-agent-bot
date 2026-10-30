import type { StayQuery } from "./types.js";

export function amount(text: string | undefined): number | undefined {
  const m = /(?:[$€£₹¥]|USD|EUR|GBP|INR)\s?(\d[\d,]*(?:\.\d+)?)/.exec(text ?? "");
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

export function count(text: string | undefined): number | undefined {
  const m = /(\d[\d,.]*)\s*([KkMm])?/.exec(text ?? "");
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ""));
  const scale = m[2]?.toLowerCase() === "k" ? 1_000 : m[2]?.toLowerCase() === "m" ? 1_000_000 : 1;
  return Number.isFinite(n) ? Math.round(n * scale) : undefined;
}

export const nightlyFromTotal = (total: number | undefined, q: StayQuery) =>
  total != null && q.nights > 0 ? Math.round(total / q.nights) : undefined;
export const totalFromNightly = (nightly: number | undefined, q: StayQuery) => (nightly != null ? nightly * q.nights : undefined);

export function cleanUrl(raw: string | undefined, keep: string[]): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    const params = new URLSearchParams();
    for (const k of keep) {
      const v = u.searchParams.get(k);
      if (v) params.set(k, v);
    }
    const query = params.toString();
    return `${u.origin}${u.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return undefined;
  }
}

const SYMBOL_CURRENCY: Array<[RegExp, string]> = [
  [/€|\bEUR\b/, "EUR"],
  [/£|\bGBP\b/, "GBP"],
  [/₹|\bINR\b/, "INR"],
  [/\bUSD\b/, "USD"],
];
const DOLLAR_CURRENCIES = new Set(["USD", "CAD", "AUD", "NZD", "SGD", "MXN", "HKD"]);

export function currencyTag(text: string | undefined, q: StayQuery): { currency?: string } {
  const t = text ?? "";
  const found = SYMBOL_CURRENCY.find(([re]) => re.test(t))?.[1] ?? (/\$/.test(t) && !DOLLAR_CURRENCIES.has(q.currency) ? "USD" : undefined);
  return found && found !== q.currency ? { currency: found } : {};
}

export const httpImage = (src: string | undefined) => (src && /^https?:\/\//.test(src) ? src : undefined);

export const clip = (s: string | undefined, max: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
};

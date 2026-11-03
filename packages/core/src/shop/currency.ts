import type { ItemResult } from "./rank.js";

const SYMBOLS: Array<[RegExp, string]> = [
  [/₹|Rs\.?/, "INR"],
  [/£/, "GBP"],
  [/€/, "EUR"],
  [/\$/, "USD"],
];

export function currencyOf(items: ItemResult[]): string | undefined {
  for (const i of items) {
    for (const p of i.picks) {
      const hit = p.priceText && SYMBOLS.find(([re]) => re.test(p.priceText!));
      if (hit) return hit[1];
    }
  }
  return undefined;
}

export function formatMoney(n: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

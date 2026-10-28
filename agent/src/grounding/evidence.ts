export type Claim = { kind: "price" | "rating" | "stock" | "link"; text: string; index: number };

const PRICE = /(?:[$€£₹¥]\s?|\b(?:USD|INR|EUR|GBP|Rs\.?)\s?)\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:USD|INR|EUR|GBP|dollars|rupees)\b/gi;
const RATING = /\b\d(?:\.\d)?\s?(?:\/\s?5(?![\d/])|out of 5(?: stars)?|stars?\b|★)/gi;
const STOCK = /\b(?:in[ -]stock|out of stock|sold out|back[- ]?ordered|available for pickup|pickup today|ships today|only \d+ left|limited stock)\b/gi;
const LINK = /https?:\/\/[^\s<>"'\])]+/gi;
const JSON_NUMBER = (key: string) => new RegExp(`"${key}"\\s*:\\s*(\\d+(?:\\.\\d+)?)`, "gi");
const RATING_LABEL = /\brating[:\s]+(\d(?:\.\d)?)/gi;

const cents = (n: number) => Math.round(n * 100);
const firstNumber = (s: string) => Number((s.match(/\d[\d,]*(?:\.\d+)?/)?.[0] ?? "").replace(/,/g, ""));
const stockFamily = (s: string) => (/out of stock|sold out|back/i.test(s) ? "out" : "in");

function matches(re: RegExp, text: string, kind: Claim["kind"]): Claim[] {
  return [...text.matchAll(re)].map((m) => ({ kind, text: m[0].replace(/[.,;:!?]+$/, ""), index: m.index ?? 0 }));
}

export function extractClaims(text: string): Claim[] {
  const links = matches(LINK, text, "link");
  const inLink = (c: Claim) => links.some((l) => c.index >= l.index && c.index < l.index + l.text.length);
  const others = [...matches(PRICE, text, "price"), ...matches(RATING, text, "rating"), ...matches(STOCK, text, "stock")].filter((c) => !inLink(c));
  return [...links, ...others].sort((a, b) => a.index - b.index);
}

function urlKey(url: string): { host: string; path: string } | null {
  try {
    const u = new URL(url);
    return { host: u.hostname.toLowerCase().replace(/^www\./, ""), path: u.pathname.replace(/\/+$/, "") };
  } catch {
    return null;
  }
}

export class Evidence {
  private prices = new Set<number>();
  private ratings = new Set<number>();
  private stock = new Set<string>();
  private urls = new Set<string>();
  private hosts = new Set<string>();

  add(text: string): void {
    if (!text) return;
    for (const c of extractClaims(text)) {
      if (c.kind === "price") this.prices.add(cents(firstNumber(c.text)));
      else if (c.kind === "rating") this.ratings.add(cents(firstNumber(c.text)));
      else if (c.kind === "stock") this.stock.add(stockFamily(c.text));
      else {
        const k = urlKey(c.text);
        if (k) {
          this.urls.add(k.host + k.path);
          this.hosts.add(k.host);
        }
      }
    }
    for (const m of text.matchAll(JSON_NUMBER("price"))) this.prices.add(cents(Number(m[1])));
    for (const re of [JSON_NUMBER("rating"), RATING_LABEL]) for (const m of text.matchAll(re)) this.ratings.add(cents(Number(m[1])));
  }

  hasUrl(url: string): boolean {
    const k = urlKey(url);
    if (!k) return false;
    return this.urls.has(k.host + k.path) || (k.path === "" && this.hosts.has(k.host));
  }

  supports(c: Claim): boolean {
    if (c.kind === "price") return this.prices.has(cents(firstNumber(c.text)));
    if (c.kind === "rating") return this.ratings.has(cents(firstNumber(c.text)));
    if (c.kind === "stock") return this.stock.has(stockFamily(c.text));
    return this.hasUrl(c.text);
  }

  unverified(text: string): string[] {
    return [...new Set(extractClaims(text).filter((c) => !this.supports(c)).map((c) => c.text))];
  }
}

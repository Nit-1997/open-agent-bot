import type { Page } from "playwright";

export type Tile = {
  title: string;
  price?: number;
  priceText?: string;
  image?: string;
  url: string;
  sponsored: boolean;
  size?: string;
  rating?: number;
  group?: string;
};

type Raw = { title: string; priceText?: string; image?: string; url: string; text: string; group?: string };

const SIZE = /\b\d+(?:\.\d+)?\s?(?:fl\.? oz|oz|lbs?|g|kg|ml|l|ct|count|pk|pack)\b/i;
const RATING = /\b(\d(?:\.\d)?)\s?(?:out of 5|\/\s?5\b|★|stars?\b)/i;

function inPage(opts: { groupSelector?: string; groupFromHref?: string; max: number }): Raw[] {
  const PRICE = /(?:\$|£|€|₹)\s?\d[\d,]*(?:\.\d{1,2})?/;
  const PRICES = /(?:\$|£|€|₹)\s?\d[\d,]*(?:\.\d{1,2})?/g;
  const groups = opts.groupSelector ? [...document.querySelectorAll(opts.groupSelector)] : [];
  const groupOf = (el: Element) => {
    let found: string | undefined;
    const hrefRe = opts.groupFromHref ? new RegExp(opts.groupFromHref) : null;
    for (const g of groups) {
      if (!(g.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      const slug = hrefRe ? (g.getAttribute("href") ?? "").match(hrefRe)?.[1] : undefined;
      found = slug ? slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") : (g.textContent ?? "").trim();
    }
    return found;
  };
  const sourceOf = (img: HTMLImageElement) => {
    const candidates = [img.currentSrc, img.getAttribute("src"), img.getAttribute("data-src"), img.getAttribute("data-original"), img.getAttribute("srcset")?.split(/\s+/)[0]];
    const raw = candidates.find((c) => c && !c.startsWith("data:"));
    if (!raw) return undefined;
    try {
      const u = new URL(raw, location.href);
      return u.protocol === "http:" || u.protocol === "https:" ? u.href : undefined;
    } catch {
      return undefined;
    }
  };
  const textOf = (el: Element) => {
    const parts: string[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = (n.textContent ?? "").trim();
      const parent = n.parentElement;
      if (t && parent && !["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) parts.push(t);
    }
    return parts.join("\n");
  };
  const seen = new Set<Element>();
  const out: Raw[] = [];
  for (const img of [...document.images]) {
    if (out.length >= opts.max) break;
    const rect = img.getBoundingClientRect();
    const w = Math.max(rect.width, Number(img.getAttribute("width")) || 0);
    const h = Math.max(rect.height, Number(img.getAttribute("height")) || 0);
    if (w < 70 || h < 70) continue;
    let el: HTMLElement | null = img.parentElement;
    for (let i = 0; el && i < 8; i++, el = el.parentElement) {
      const text = textOf(el);
      if ((text.match(PRICES)?.length ?? 0) > 3) break;
      const link = (img.closest("a[href]") as HTMLAnchorElement | null) ?? (el.querySelector("a[href]") as HTMLAnchorElement | null);
      const price = text.match(PRICE);
      if (!price || !link) continue;
      if (!seen.has(el)) {
        seen.add(el);
        const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
        const alt = (img.alt || "").trim();
        const title = alt.length > 8 ? alt : (lines.find((l) => l.length > 12 && !PRICE.test(l) && !/^sponsored/i.test(l)) ?? alt);
        out.push({ title, priceText: price[0].replace(/\s/g, ""), image: sourceOf(img), url: link.href, text: text.slice(0, 600), group: groupOf(el) });
      }
      break;
    }
  }
  return out;
}

export function normalize(raw: Raw): Tile | null {
  const sponsored = /\bsponsored\b/i.test(raw.text) || /^sponsored/i.test(raw.title);
  const title = raw.title.replace(/^sponsored( ad)?\s*[-–:]\s*/i, "").replace(/\s+/g, " ").trim();
  if (!title || !/^https?:/.test(raw.url)) return null;
  const price = raw.priceText ? Number(raw.priceText.replace(/[^\d.]/g, "")) : undefined;
  const rating = raw.text.match(RATING);
  const size = raw.text.match(SIZE) ?? title.match(SIZE);
  return {
    title: title.slice(0, 120),
    ...(price !== undefined && Number.isFinite(price) && { price, priceText: raw.priceText }),
    ...(raw.image && { image: raw.image }),
    url: raw.url,
    sponsored,
    ...(size && { size: size[0] }),
    ...(rating && { rating: Number(rating[1]) }),
    ...(raw.group && { group: raw.group.slice(0, 60) }),
  };
}

export async function extractTiles(page: Page, opts: { groupSelector?: string; groupFromHref?: string; max?: number } = {}): Promise<Tile[]> {
  const raws = await page.evaluate(inPage, { groupSelector: opts.groupSelector, groupFromHref: opts.groupFromHref, max: opts.max ?? 150 });
  return raws.map(normalize).filter((t): t is Tile => t !== null);
}

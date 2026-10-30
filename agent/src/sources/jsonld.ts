export type LdKind = "product" | "lodging" | "restaurant" | "event";

export type LdRecord = {
  kind: LdKind;
  name: string;
  url?: string;
  image?: string;
  description?: string;
  brand?: string;
  price?: number;
  highPrice?: number;
  currency?: string;
  availability?: string;
  offerCount?: number;
  rating?: number;
  reviews?: number;
  address?: string;
  telephone?: string;
  priceRange?: string;
  cuisine?: string;
  startDate?: string;
  endDate?: string;
  location?: string;
};

type Node = Record<string, unknown>;

const SCRIPT = /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
const PRODUCT = new Set(["Product", "ProductGroup", "IndividualProduct", "SomeProducts", "Vehicle", "Car", "Book", "Movie"]);
const LODGING = new Set([
  "Hotel",
  "LodgingBusiness",
  "Resort",
  "Hostel",
  "Motel",
  "BedAndBreakfast",
  "Campground",
  "VacationRental",
  "Apartment",
  "House",
]);
const RESTAURANT = new Set([
  "Restaurant",
  "FoodEstablishment",
  "CafeOrCoffeeShop",
  "BarOrPub",
  "Bakery",
  "FastFoodRestaurant",
  "IceCreamShop",
  "Winery",
  "Brewery",
]);
const MAX_RECORDS = 40;

const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

function text(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number") return String(v);
  if (isNode(v)) return text(v.name ?? v["@value"]);
  if (Array.isArray(v)) return v.map(text).find(Boolean);
  return undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  const cleaned = v.replace(/[^\d.,-]/g, "");
  if (!cleaned) return undefined;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const decimalComma = lastComma > lastDot && cleaned.length - lastComma - 1 <= 2;
  const n = Number(decimalComma ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function url(v: unknown): string | undefined {
  const s = text(isNode(v) ? (v.url ?? v["@id"] ?? v.contentUrl) : v);
  return s && /^(https?:)?\//i.test(s) ? s : undefined;
}

function image(v: unknown): string | undefined {
  for (const x of list(v)) {
    const u = url(x);
    if (u) return u;
  }
  return undefined;
}

function address(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (!isNode(v)) return undefined;
  const parts = [
    v.streetAddress,
    v.addressLocality,
    v.addressRegion,
    v.postalCode,
    isNode(v.addressCountry) ? v.addressCountry.name : v.addressCountry,
  ]
    .map(text)
    .filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

function types(node: Node): string[] {
  return list(node["@type"])
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.replace(/^.*[/#]/, ""));
}

function kindOf(node: Node): LdKind | undefined {
  const ts = types(node);
  if (ts.some((t) => PRODUCT.has(t))) return "product";
  if (ts.some((t) => LODGING.has(t))) return "lodging";
  if (ts.some((t) => RESTAURANT.has(t))) return "restaurant";
  if (ts.some((t) => t === "Event" || t.endsWith("Event"))) return "event";
  return undefined;
}

type Offer = { price?: number; high?: number; currency?: string; availability?: string; count?: number };

const OUT = /OutOfStock|SoldOut|Discontinued/i;

function offersOf(raw: unknown, depth = 0): Offer[] {
  return list(raw).flatMap((o): Offer[] => {
    if (!isNode(o) || depth > 3) return [];
    const spec = list(o.priceSpecification).find(isNode) as Node | undefined;
    const nested = offersOf(o.offers, depth + 1);
    const price = num(o.price) ?? num(o.lowPrice) ?? num(spec?.price) ?? num(spec?.minPrice);
    const here: Offer = {
      price,
      high: num(o.highPrice) ?? num(spec?.maxPrice),
      currency: text(o.priceCurrency) ?? text(spec?.priceCurrency),
      availability: text(o.availability)?.replace(/^.*[/#]/, ""),
      count: num(o.offerCount),
    };
    return price != null || here.availability ? [here, ...nested] : nested;
  });
}

function priceOf(offers: Offer[]): Partial<LdRecord> {
  const priced = offers.filter((o) => o.price != null);
  const live = priced.filter((o) => !o.availability || !OUT.test(o.availability));
  const pool = live.length ? live : priced;
  const best = pool.reduce<Offer | undefined>((a, o) => (a == null || (o.price as number) < (a.price as number) ? o : a), undefined);
  const availability =
    best?.availability ?? live.find((o) => o.availability)?.availability ?? offers.find((o) => o.availability)?.availability;
  const high = Math.max(...priced.map((o) => o.high ?? (o.price as number)), Number.NEGATIVE_INFINITY);
  const count = offers.map((o) => o.count).find((c) => c != null);
  return {
    ...(best?.price != null && { price: best.price }),
    ...(Number.isFinite(high) && best?.price != null && high > best.price && { highPrice: high }),
    ...((best?.currency ?? offers.find((o) => o.currency)?.currency) && {
      currency: best?.currency ?? offers.find((o) => o.currency)?.currency,
    }),
    ...(availability && { availability }),
    ...(count != null && { offerCount: count }),
  };
}

function ratingOf(node: Node): Partial<LdRecord> {
  const r = list(node.aggregateRating).find(isNode) as Node | undefined;
  const rating = num(r?.ratingValue);
  const reviews = num(r?.reviewCount) ?? num(r?.ratingCount);
  return { ...(rating != null && { rating }), ...(reviews != null && { reviews }) };
}

function place(v: unknown): string | undefined {
  const p = list(v).find((x) => isNode(x) || typeof x === "string");
  if (typeof p === "string") return p.trim() || undefined;
  if (!isNode(p)) return undefined;
  return [text(p.name), address(p.address)].filter(Boolean).join(", ") || undefined;
}

function recordOf(node: Node, kind: LdKind, parent?: Node): LdRecord | null {
  const name = text(node.name) ?? text(parent?.name);
  if (!name) return null;
  const offers = offersOf(node.offers);
  const base: LdRecord = {
    kind,
    name,
    ...(url(node) && { url: url(node) }),
    ...(image(node.image ?? parent?.image) && { image: image(node.image ?? parent?.image) }),
    ...(text(node.description) && { description: (text(node.description) as string).slice(0, 300) }),
  };
  const brand = text(node.brand) ?? text(parent?.brand);
  const rating = ratingOf(node);
  const group = parent ? ratingOf(parent) : {};
  return {
    ...base,
    ...(brand && { brand }),
    ...priceOf(offers),
    ...group,
    ...rating,
    ...(address(node.address) && { address: address(node.address) }),
    ...(text(node.telephone) && { telephone: text(node.telephone) }),
    ...(text(node.priceRange) && { priceRange: text(node.priceRange) }),
    ...(text(node.servesCuisine) && { cuisine: list(node.servesCuisine).map(text).filter(Boolean).join(", ") }),
    ...(text(node.startDate) && { startDate: text(node.startDate) }),
    ...(text(node.endDate) && { endDate: text(node.endDate) }),
    ...(place(node.location) && { location: place(node.location) }),
  };
}

function walk(raw: unknown, out: LdRecord[], depth = 0, parent?: Node): void {
  if (out.length >= MAX_RECORDS || depth > 6) return;
  for (const v of list(raw)) {
    if (!isNode(v)) continue;
    const kind = kindOf(v);
    if (kind) {
      const variants = list(v.hasVariant).filter(isNode);
      if (variants.length) {
        for (const variant of variants) {
          const k = kindOf(variant) ?? kind;
          const r = recordOf(variant, k, v);
          if (r) out.push(r);
        }
      } else {
        const r = recordOf(v, kind, parent);
        if (r) out.push(r);
      }
    }
    walk(v["@graph"], out, depth + 1);
    walk(v.mainEntity, out, depth + 1);
    for (const el of list(v.itemListElement)) walk(isNode(el) && el.item ? el.item : el, out, depth + 1);
  }
}

function parseBlock(src: string): unknown {
  const body = src
    .replace(/^\s*<!--/, "")
    .replace(/-->\s*$/, "")
    .replace(/^\s*\/\*[\s\S]*?\*\/|^\s*\/\/<!\[CDATA\[|\/\/\]\]>\s*$/g, "")
    .trim();
  try {
    return JSON.parse(body);
  } catch {
    try {
      return JSON.parse([...body].map((c) => (c.charCodeAt(0) < 32 ? " " : c)).join(""));
    } catch {
      return undefined;
    }
  }
}

export function parseJsonLd(html: string, base?: string): LdRecord[] {
  const out: LdRecord[] = [];
  for (const m of html.matchAll(SCRIPT)) walk(parseBlock(m[1]), out);
  const seen = new Set<string>();
  return out
    .map((r) => {
      if (!base) return r;
      const abs = (u?: string) => {
        if (!u) return u;
        try {
          return new URL(u, base).href;
        } catch {
          return u;
        }
      };
      return { ...r, ...(r.url && { url: abs(r.url) }), ...(r.image && { image: abs(r.image) }) };
    })
    .filter((r) => {
      const key = `${r.kind}|${r.name}|${r.url ?? ""}|${r.price ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function describeRecord(r: LdRecord): string {
  const money = r.price != null ? `${r.currency ? `${r.currency} ` : ""}${r.price}${r.highPrice ? `-${r.highPrice}` : ""}` : undefined;
  const bits = [
    money,
    r.availability,
    r.rating != null && `${r.rating}/5${r.reviews ? ` (${r.reviews} reviews)` : ""}`,
    r.brand && `brand ${r.brand}`,
    r.priceRange && `price range ${r.priceRange}`,
    r.cuisine,
    r.startDate && `starts ${r.startDate}`,
    r.location,
    r.address,
  ].filter(Boolean);
  return `- ${r.kind}: ${r.name}${bits.length ? ` — ${bits.join(", ")}` : ""}`;
}

export function structuredLines(records: LdRecord[], max = 6): string[] {
  return records.slice(0, max).map(describeRecord);
}

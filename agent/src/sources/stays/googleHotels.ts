import { staySource } from "./define.js";
import { amount, clip, count, currencyTag, httpImage, totalFromNightly } from "../../stays/parse.js";
import type { Stay, StayQuery } from "../../stays/types.js";

export type GoogleCard = { name: string; priceLabel: string; text: string; image?: string };

function collect(): GoogleCard[] {
  const PRICE = 'a[aria-label^="Prices starting from"]';
  const seen = new Set<Element>();
  const cards: GoogleCard[] = [];
  for (const a of document.querySelectorAll(PRICE)) {
    const label = a.getAttribute("aria-label");
    const onlyThis = (el: Element) => [...el.querySelectorAll(PRICE)].every((x) => x.getAttribute("aria-label") === label);
    let el: Element = a;
    while (el.parentElement && onlyThis(el.parentElement)) el = el.parentElement;
    if (seen.has(el)) continue;
    seen.add(el);
    const named = [...el.querySelectorAll("a[aria-label]")].map((x) => x.getAttribute("aria-label") ?? "").find((l) => l && !l.startsWith("Prices") && !/^(Open|Save|Photo)/.test(l));
    cards.push({ name: named ?? "", priceLabel: label ?? "", text: (el as HTMLElement).innerText.replace(/\s+/g, " "), image: el.querySelector("img")?.src });
  }
  return cards;
}

const searchFor = (q: StayQuery, query: string) => {
  const u = new URL("https://www.google.com/travel/search");
  u.searchParams.set("q", query);
  u.searchParams.set("hl", "en-US");
  u.searchParams.set("curr", q.currency);
  u.searchParams.set("checkin", q.checkin);
  u.searchParams.set("checkout", q.checkout);
  u.searchParams.set("adults", String(q.adults));
  return u.href;
};

export function parseGoogleCard(c: GoogleCard, q: StayQuery): Stay | null {
  const fromLabel = /^Prices starting from [^,]+, (.+)$/.exec(c.priceLabel)?.[1]?.replace(/\s+(DEAL|GREAT DEAL)\b.*$/i, "");
  const title = clip(c.name || fromLabel, 120);
  if (!title) return null;
  const nightly = amount(c.priceLabel);
  const rating = /(\d\.\d)\s*\(([\d.,]+[KkMm]?)\)/.exec(c.text);
  const deal = /(\d+)% less than usual/i.exec(c.text);
  const stars = /(\d)-star hotel/i.exec(c.text);
  const rental = /\b(Sleeps \d+|bedrooms?|Apartment|Condo|Entire home|Villa|Cabin)\b/i.test(c.text);
  return {
    title,
    url: searchFor(q, `${title} ${q.location}`),
    ...(httpImage(c.image) && { image: c.image }),
    ...(nightly != null && { nightly, total: totalFromNightly(nightly, q), ...currencyTag(c.priceLabel, q) }),
    ...(rating && { rating: Number(rating[1]), ratingScale: 5 as const, reviews: count(rating[2]) }),
    kind: rental ? "Rental" : stars ? `${stars[1]}-star hotel` : "Hotel",
    ...(deal && { badge: `${deal[1]}% off usual` }),
  };
}

export const googleHotels = staySource({
  id: "google_hotels",
  label: "Google Hotels",
  site: "google.com",
  lists: ["hotel", "rental"],
  searchUrl: (q) => searchFor(q, `hotels in ${q.location}`),
  read: async (page, q) => (await page.evaluate(collect)).map((c) => parseGoogleCard(c, q)).filter((s): s is Stay => s !== null),
});

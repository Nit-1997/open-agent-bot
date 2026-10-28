import { amount, cleanUrl, clip, count, httpImage, nightlyFromTotal } from "../parse.js";
import type { Stay, StayQuery, StaySource } from "../types.js";

export type AirbnbCard = { title: string; name?: string; href?: string; image?: string; text: string };

function collect(): AirbnbCard[] {
  return [...document.querySelectorAll('[data-testid="card-container"]')].map((card) => ({
    title: card.querySelector('[data-testid="listing-card-title"]')?.textContent?.trim() ?? "",
    name: card.querySelector('[data-testid="listing-card-name"]')?.textContent?.trim() || undefined,
    href: card.querySelector<HTMLAnchorElement>('a[href*="/rooms/"]')?.href,
    image: card.querySelector("img")?.src,
    text: (card as HTMLElement).innerText,
  }));
}

const TYPE_IN_PLACE = /^([A-Z][\w-]*(?: [a-z][\w-]*)*) in (.+)$/;

export function parseAirbnbCard(c: AirbnbCard, q: StayQuery): Stay | null {
  const url = cleanUrl(c.href, ["check_in", "check_out", "adults"]);
  const typeLine = c.text.split("\n").map((l) => l.trim()).find((l) => TYPE_IN_PLACE.test(l));
  const titleIsType = TYPE_IN_PLACE.test(c.title);
  const title = clip(titleIsType ? (c.name ?? c.title) : c.title, 120);
  if (!title || !url) return null;
  const typed = TYPE_IN_PLACE.exec(titleIsType ? c.title : (typeLine ?? ""));
  const total = amount(/([$€£₹][\d,]+(?:\.\d+)?)\s*(?:total|for \d+ nights?)/i.exec(c.text)?.[1]);
  const rating = /(\d(?:\.\d+)?) out of 5 average rating,\s*([\d,]+) reviews?/i.exec(c.text);
  return {
    title,
    url,
    ...(httpImage(c.image) && { image: c.image }),
    ...(total != null && { total, nightly: nightlyFromTotal(total, q) }),
    ...(rating && { rating: Number(rating[1]), ratingScale: 5 as const, reviews: count(rating[2]) }),
    ...(typed && { kind: typed[1], area: clip(typed[2], 60) }),
    ...(/Guest favorite/i.test(c.text) && { badge: "Guest favorite" }),
  };
}

export const airbnb: StaySource = {
  id: "airbnb",
  label: "Airbnb",
  site: "airbnb.com",
  lists: ["rental"],
  searchUrl: (q) => {
    const u = new URL(`https://www.airbnb.com/s/${encodeURIComponent(q.location)}/homes`);
    u.searchParams.set("checkin", q.checkin);
    u.searchParams.set("checkout", q.checkout);
    u.searchParams.set("adults", String(q.adults));
    u.searchParams.set("currency", q.currency);
    u.searchParams.set("locale", "en");
    return u.href;
  },
  read: async (page, q) => (await page.evaluate(collect)).map((c) => parseAirbnbCard(c, q)).filter((s): s is Stay => s !== null),
};

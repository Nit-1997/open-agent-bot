import { amount, cleanUrl, clip, count, httpImage, nightlyFromTotal } from "../parse.js";
import type { Stay, StayQuery, StaySource } from "../types.js";

export type BookingCard = { title: string; href?: string; price: string; score: string; image?: string; area: string };

function collect(): BookingCard[] {
  return [...document.querySelectorAll('[data-testid="property-card"]')].map((card) => ({
    title: card.querySelector('[data-testid="title"]')?.textContent?.trim() ?? "",
    href: card.querySelector<HTMLAnchorElement>('a[data-testid="title-link"]')?.href,
    price: card.querySelector('[data-testid="price-and-discounted-price"]')?.textContent ?? "",
    score: card.querySelector('[data-testid="review-score"]')?.textContent ?? "",
    image: (card.querySelector<HTMLImageElement>('img[data-testid="image"]') ?? card.querySelector("img"))?.src,
    area: card.querySelector('[data-testid="address"]')?.textContent ?? "",
  }));
}

export function parseBookingCard(c: BookingCard, q: StayQuery): Stay | null {
  const title = clip(c.title, 120);
  const url = cleanUrl(c.href, ["checkin", "checkout", "group_adults", "no_rooms"]);
  if (!title || !url) return null;
  const total = amount(c.price);
  const score = /Scored (\d+(?:\.\d)?)/.exec(c.score);
  const reviews = /([\d,]+) reviews?/.exec(c.score);
  return {
    title,
    url,
    ...(httpImage(c.image) && { image: c.image }),
    ...(total != null && { total, nightly: nightlyFromTotal(total, q) }),
    ...(score && { rating: Number(score[1]), ratingScale: 10 as const, ...(reviews && { reviews: count(reviews[1]) }) }),
    ...(clip(c.area, 60) && { area: clip(c.area, 60) }),
  };
}

export const booking: StaySource = {
  id: "booking",
  label: "Booking.com",
  site: "booking.com",
  lists: ["hotel", "rental"],
  searchUrl: (q) => {
    const u = new URL("https://www.booking.com/searchresults.html");
    u.searchParams.set("ss", q.location);
    u.searchParams.set("checkin", q.checkin);
    u.searchParams.set("checkout", q.checkout);
    u.searchParams.set("group_adults", String(q.adults));
    u.searchParams.set("no_rooms", String(q.rooms));
    u.searchParams.set("group_children", "0");
    u.searchParams.set("selected_currency", q.currency);
    u.searchParams.set("lang", "en-us");
    return u.href;
  },
  read: async (page, q) => (await page.evaluate(collect)).map((c) => parseBookingCard(c, q)).filter((s): s is Stay => s !== null),
};

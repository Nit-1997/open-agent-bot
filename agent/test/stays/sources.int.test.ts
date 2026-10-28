import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { airbnb } from "../../src/stays/sources/airbnb.js";
import { booking } from "../../src/stays/sources/booking.js";
import { googleHotels } from "../../src/stays/sources/googleHotels.js";
import type { StayQuery } from "../../src/stays/types.js";

const q: StayQuery = { location: "Las Vegas", checkin: "2026-11-12", checkout: "2026-11-15", nights: 3, adults: 2, rooms: 1, currency: "USD" };

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});

afterAll(async () => {
  await browser.close();
});

describe("stay source readers in a real page", () => {
  it("Google Hotels: one stay per card, named from the card", async () => {
    await page.setContent(`
      <div class="card"><img src="https://img.test/bellagio.jpg" width="200" height="120">
        <a aria-label="Bellagio Hotel &amp; Casino" href="https://www.google.com/travel/x">Bellagio Hotel &amp; Casino</a>
        <div><a aria-label="Prices starting from $131, Bellagio Hotel &amp; Casino DEAL 24% less than usual" href="https://www.google.com/travel/x">$131</a></div>
        <div><span>4.7</span><br><span>(144.3K)</span> · 5-star hotel</div>
        <a aria-label="Prices starting from $131, Bellagio Hotel &amp; Casino DEAL 24% less than usual" href="https://www.google.com/travel/x">View prices</a></div>
      <div class="card"><img src="https://img.test/linq.jpg" width="200" height="120">
        <a aria-label="The LINQ" href="https://www.google.com/travel/y">The LINQ</a>
        <div><a aria-label="Prices starting from $88, The LINQ" href="https://www.google.com/travel/y">$88</a></div>
        <span>4.1 (52K)</span></div>`);
    const stays = await googleHotels.read!(page, q);
    expect(stays.map((s) => [s.title, s.nightly, s.rating])).toEqual([
      ["Bellagio Hotel & Casino", 131, 4.7],
      ["The LINQ", 88, 4.1],
    ]);
    expect(stays[0]).toMatchObject({ image: "https://img.test/bellagio.jpg", reviews: 144300, kind: "5-star hotel" });
  });

  it("Airbnb: reads every card container", async () => {
    await page.setContent(`
      <div data-testid="card-container"><a href="https://www.airbnb.com/rooms/1?check_in=2026-11-12&check_out=2026-11-15&adults=2&source_impression_id=z"><img src="https://img.test/a.jpg"></a>
        <div data-testid="listing-card-title">Condo in Paradise</div><div data-testid="listing-card-name">Strip view 2BR</div>
        <div>4.9 out of 5 average rating, 210 reviews</div><div>$720 for 3 nights</div></div>`);
    const [s] = await airbnb.read!(page, q);
    expect(s).toMatchObject({ title: "Strip view 2BR", total: 720, nightly: 240, rating: 4.9, kind: "Condo", url: "https://www.airbnb.com/rooms/1?check_in=2026-11-12&check_out=2026-11-15&adults=2" });
  });

  it("Booking.com: reads property cards and skips ads outside them", async () => {
    await page.setContent(`
      <a href="https://www.booking.com/co_brand_card.html"><img src="https://img.test/card.jpg"> Genius Rewards Visa® $150</a>
      <div data-testid="property-card"><img data-testid="image" src="https://img.test/fl.jpg">
        <a data-testid="title-link" href="https://www.booking.com/hotel/us/flamingo.html?aid=1&checkin=2026-11-12"><div data-testid="title">Flamingo Las Vegas</div></a>
        <span data-testid="address">Las Vegas Strip, Las Vegas</span>
        <div data-testid="review-score">Scored 7.8 7.8 Good 24,667 reviews</div>
        <span data-testid="price-and-discounted-price">$853</span></div>`);
    const stays = await booking.read!(page, q);
    expect(stays).toHaveLength(1);
    expect(stays[0]).toMatchObject({ title: "Flamingo Las Vegas", total: 853, nightly: 284, rating: 7.8, ratingScale: 10, reviews: 24667 });
  });
});

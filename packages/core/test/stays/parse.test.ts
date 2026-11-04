import { describe, expect, it } from "vitest";
import { parseAirbnbCard } from "../../src/sources/stays/airbnb.js";
import { parseBookingCard } from "../../src/sources/stays/booking.js";
import { googleHotels, parseGoogleCard } from "../../src/sources/stays/googleHotels.js";
import { amount, cleanUrl, count } from "../../src/stays/parse.js";
import type { StayQuery } from "../../src/stays/types.js";

const q: StayQuery = {
  location: "Las Vegas",
  checkin: "2026-11-12",
  checkout: "2026-11-15",
  nights: 3,
  adults: 2,
  rooms: 1,
  currency: "USD",
};

describe("google hotels search", () => {
  it("names the wished-for chains in the search so their hotels come back", () => {
    const query = (x: StayQuery) => new URL(googleHotels.searchUrl(x)).searchParams.get("q");
    expect(query(q)).toBe("hotels in Las Vegas");
    expect(query({ ...q, brands: ["Marriott", "Hyatt"] })).toBe("Marriott or Hyatt hotels in Las Vegas");
  });
});

describe("stay parsing helpers", () => {
  it("reads amounts and review counts", () => {
    expect(amount("$1,262")).toBe(1262);
    expect(amount("₹4,500 total")).toBe(4500);
    expect(amount("no price")).toBeUndefined();
    expect(count("144.3K")).toBe(144300);
    expect(count("1,861")).toBe(1861);
  });

  it("keeps only the listed query params", () => {
    expect(cleanUrl("https://www.booking.com/hotel/us/x.html?aid=1&label=y&checkin=2026-11-12", ["checkin"])).toBe(
      "https://www.booking.com/hotel/us/x.html?checkin=2026-11-12",
    );
    expect(cleanUrl("javascript:alert(1)", [])).toBeUndefined();
  });
});

describe("Google Hotels cards", () => {
  it("reads name, nightly price, rating, deal and hotel class", () => {
    const s = parseGoogleCard(
      {
        name: "Bellagio Hotel & Casino",
        priceLabel: "Prices starting from $131, Bellagio Hotel & Casino DEAL 24% less than usual",
        text: "Bellagio Hotel & Casino DEAL $131 24% less than usual 4.7 (144.3K) · Excellent location Amenities for Bellagio Hotel & Casino, a 5-star hotel.: Breakfast",
        image: "https://lh3.googleusercontent.com/a",
      },
      q,
    );
    expect(s).toMatchObject({
      title: "Bellagio Hotel & Casino",
      nightly: 131,
      total: 393,
      rating: 4.7,
      ratingScale: 5,
      reviews: 144300,
      kind: "5-star hotel",
      badge: "24% off usual",
    });
    expect(s?.url).toContain("google.com/travel/search?q=Bellagio+Hotel+%26+Casino+Las+Vegas");
  });

  it("falls back to the price label for the name and spots rentals", () => {
    const s = parseGoogleCard(
      {
        name: "",
        priceLabel: "Prices starting from $314, MGM Signature PH strip view condo",
        text: "$314 5.0 (8) · Apartment, Sleeps 4, 2 bedrooms",
      },
      q,
    );
    expect(s).toMatchObject({ title: "MGM Signature PH strip view condo", nightly: 314, kind: "Rental", reviews: 8 });
  });
});

describe("Airbnb cards", () => {
  it("reads total for the stay and derives the nightly price", () => {
    const s = parseAirbnbCard(
      {
        title: "Luxor Hotel and Casino",
        href: "https://www.airbnb.com/rooms/1330478823292451559?adults=2&check_in=2026-11-12&check_out=2026-11-15&search_mode=regular_search&source_impression_id=p3",
        image: "https://a0.muscache.com/im/pictures/x.jpg",
        text: "Featured hotel\nLuxor Hotel and Casino\n4.27 out of 5 average rating, 1861 reviews\nHotel in Las Vegas Strip\n$700 $575 for 3 nights\nFree cancellation",
      },
      q,
    );
    expect(s).toMatchObject({
      title: "Luxor Hotel and Casino",
      total: 575,
      nightly: 192,
      rating: 4.27,
      reviews: 1861,
      kind: "Hotel",
      area: "Las Vegas Strip",
    });
    expect(s?.url).toBe("https://www.airbnb.com/rooms/1330478823292451559?check_in=2026-11-12&check_out=2026-11-15&adults=2");
  });

  it("uses the listing name when the title is just the home type", () => {
    const s = parseAirbnbCard(
      {
        title: "Condo in Paradise",
        name: "Strip view 2BR with pool",
        href: "https://www.airbnb.com/rooms/1",
        text: "Condo in Paradise\nGuest favorite\n$900 total",
      },
      q,
    );
    expect(s).toMatchObject({
      title: "Strip view 2BR with pool",
      kind: "Condo",
      area: "Paradise",
      total: 900,
      nightly: 300,
      badge: "Guest favorite",
    });
  });
});

describe("Booking.com cards", () => {
  it("reads the stay total, score out of 10 and area", () => {
    const s = parseBookingCard(
      {
        title: "Planet Hollywood Resort & Casino",
        href: "https://www.booking.com/hotel/us/planet-hollywood.html?aid=304142&label=mkt&checkin=2026-11-12&checkout=2026-11-15&group_adults=2",
        price: "$1,262",
        score: "Scored 8.1 8.1 Very Good 13,204 reviews",
        image: "https://cf.bstatic.com/x.jpg",
        area: "Las Vegas Strip, Las Vegas",
      },
      q,
    );
    expect(s).toMatchObject({
      title: "Planet Hollywood Resort & Casino",
      total: 1262,
      nightly: 421,
      rating: 8.1,
      ratingScale: 10,
      reviews: 13204,
      area: "Las Vegas Strip, Las Vegas",
    });
    expect(s?.url).toBe("https://www.booking.com/hotel/us/planet-hollywood.html?checkin=2026-11-12&checkout=2026-11-15&group_adults=2");
  });

  it("drops cards without a title or link", () => {
    expect(parseBookingCard({ title: "", href: "https://www.booking.com/x", price: "", score: "", area: "" }, q)).toBeNull();
    expect(parseBookingCard({ title: "Ad", price: "$150", score: "", area: "" }, q)).toBeNull();
  });
});

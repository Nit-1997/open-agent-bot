import { describe, expect, it } from "vitest";
import { currencyTag } from "../../src/stays/parse.js";
import type { StayQuery } from "../../src/stays/types.js";

const q = (currency: string): StayQuery => ({ location: "Paris", checkin: "2026-12-10", checkout: "2026-12-13", nights: 3, adults: 2, rooms: 1, currency });

describe("currencyTag", () => {
  it("tags a price only when it differs from the currency that was asked for", () => {
    expect(currencyTag("€350", q("EUR"))).toEqual({});
    expect(currencyTag("€350", q("USD"))).toEqual({ currency: "EUR" });
    expect(currencyTag("£120 total", q("EUR"))).toEqual({ currency: "GBP" });
    expect(currencyTag("₹4,500", q("USD"))).toEqual({ currency: "INR" });
    expect(currencyTag("EUR 300", q("USD"))).toEqual({ currency: "EUR" });
  });

  it("reads a dollar sign as USD unless a dollar currency was asked for", () => {
    expect(currencyTag("$420", q("EUR"))).toEqual({ currency: "USD" });
    expect(currencyTag("$420", q("USD"))).toEqual({});
    expect(currencyTag("$420", q("CAD"))).toEqual({});
  });

  it("tags nothing for text without a currency", () => {
    expect(currencyTag(undefined, q("EUR"))).toEqual({});
    expect(currencyTag("420", q("EUR"))).toEqual({});
  });
});

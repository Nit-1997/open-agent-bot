import { describe, expect, it } from "vitest";
import { currencyOf, formatMoney } from "../../src/shop/currency.js";
import { renderData } from "../../src/render/registry.js";

const item = (priceText?: string) => ({
  query: "rice",
  qty: 1,
  picks: priceText ? [{ title: "Rice", url: "https://x.in/r", sponsored: false, price: 1, priceText }] : [],
});

describe("cart currency", () => {
  it("reads the currency from the store's own price labels", () => {
    expect(currencyOf([item(), item("₹350")])).toBe("INR");
    expect(currencyOf([item("£2.10")])).toBe("GBP");
    expect(currencyOf([item("$3.99")])).toBe("USD");
    expect(currencyOf([item()])).toBeUndefined();
  });

  it("formats totals in that currency", () => {
    expect(formatMoney(350, "INR")).toBe("₹350.00");
    expect(formatMoney(4.37)).toBe("$4.37");
  });

  it("puts the currency on the cart widget", () => {
    const w = renderData({
      kind: "shop",
      stores: [{ store: "Amazon", home: "https://www.amazon.in/", items: [item("₹350")] }],
      summary: [{ store: "Amazon", found: 1, missing: [], total: 350 }],
    }) as { stores: Array<{ currency?: string }> };
    expect(w.stores[0].currency).toBe("INR");
  });
});

import { describe, expect, it } from "vitest";
import { checkAction, isBlockedUrl } from "../../src/tools/browsePolicy.js";

describe("checkAction", () => {
  it("allows search input typing on amazon.in", () => {
    expect(
      checkAction({ op: "type", selector: "#twotabsearchtextbox", value: "sony xm5" }, {
        url: "https://www.amazon.in/",
        target: { type: "text", name: "field-keywords" },
      }),
    ).toEqual({ allowed: true });
  });

  it("blocks goto to /checkout", () => {
    const r = checkAction({ op: "goto", url: "https://shop.example.com/checkout?step=1" }, { url: "about:blank" });
    expect(r.allowed).toBe(false);
  });

  it('blocks click on "Proceed to checkout"', () => {
    const r = checkAction({ op: "click", text: "Proceed to checkout" }, { url: "https://www.amazon.in/dp/B09XS7JWHH", target: { text: "Proceed to checkout" } });
    expect(r.allowed).toBe(false);
  });

  it("blocks clicking Add to Cart and Buy Now", () => {
    for (const text of ["Add to Cart", "Buy Now", "Book now", "Place your order"]) {
      expect(checkAction({ op: "click", text }, { url: "https://x.com/p", target: { text } }).allowed).toBe(false);
    }
  });

  it("blocks typing into password field", () => {
    const r = checkAction({ op: "type", selector: "#pw", value: "x" }, { url: "https://x.com/", target: { type: "password" } });
    expect(r.allowed).toBe(false);
  });

  it("blocks cc-number autocomplete", () => {
    const r = checkAction({ op: "type", selector: "#cc", value: "4111" }, { url: "https://x.com/", target: { autocomplete: "cc-number" } });
    expect(r.allowed).toBe(false);
  });

  it("allows pincode input", () => {
    const r = checkAction({ op: "type", selector: "#pincode", value: "411001" }, {
      url: "https://www.flipkart.com/sony-wh-1000xm5/p/itm123",
      target: { type: "text", name: "pincode", text: "Enter Delivery Pincode" },
    });
    expect(r).toEqual({ allowed: true });
  });

  it("blocks any action while on a login page", () => {
    const r = checkAction({ op: "read" }, { url: "https://accounts.google.com/signin/v2" });
    expect(r.allowed).toBe(false);
  });
});

describe("isBlockedUrl", () => {
  it("does not block ordinary product, search, author and flight urls", () => {
    for (const u of [
      "https://www.amazon.in/s?k=sony+headphones",
      "https://www.amazon.com/Sony-WH-1000XM5-Canceling-Headphones/dp/B09XS7JWHH",
      "https://www.google.com/travel/flights?q=Flights%20from%20SFO%20to%20BLR",
      "https://blog.example.com/author/jane",
      "https://www.paytmmall.com/shop/search?q=diya",
    ]) {
      expect(isBlockedUrl(u), u).toBe(false);
    }
  });

  it("blocks cart, payment, login, signup, account urls", () => {
    for (const u of [
      "https://www.amazon.in/gp/cart/view.html",
      "https://pay.google.com/x",
      "https://www.flipkart.com/account/login",
      "https://example.com/sign-up",
      "https://example.com/oauth/authorize",
      "https://example.com/billing",
    ]) {
      expect(isBlockedUrl(u), u).toBe(true);
    }
  });
});

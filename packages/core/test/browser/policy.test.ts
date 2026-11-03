import { describe, expect, it } from "vitest";
import { checkAction, isBlockedUrl } from "../../src/browser/policy.js";

describe("checkAction", () => {
  it("allows search input typing on amazon.in", () => {
    expect(
      checkAction(
        { op: "type", selector: "#twotabsearchtextbox", value: "sony xm5" },
        {
          url: "https://www.amazon.in/",
          target: { type: "text", name: "field-keywords" },
        },
      ),
    ).toEqual({ allowed: true });
  });

  it("blocks goto to /checkout", () => {
    const r = checkAction({ op: "goto", url: "https://shop.example.com/checkout?step=1" }, { url: "about:blank" });
    expect(r.allowed).toBe(false);
  });

  it('blocks click on "Proceed to checkout"', () => {
    const r = checkAction(
      { op: "click", text: "Proceed to checkout" },
      { url: "https://www.amazon.in/dp/B09XS7JWHH", target: { text: "Proceed to checkout" } },
    );
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
    const r = checkAction(
      { op: "type", selector: "#pincode", value: "411001" },
      {
        url: "https://www.flipkart.com/sony-wh-1000xm5/p/itm123",
        target: { type: "text", name: "pincode", text: "Enter Delivery Pincode" },
      },
    );
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
      "https://www.booking.com/searchresults.html?ss=Las+Vegas&checkin=2026-11-12",
      "https://www.booking.com/hotel/us/the-linq.html",
      "https://www.booking.co.uk/searchresults.html?ss=London",
      "https://www.bookshop.org/search?q=dune",
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
      "https://secure.booking.com/book.html?hotel_id=1",
      "https://accounts.google.com/signin",
      "https://login.example.co.uk/",
    ]) {
      expect(isBlockedUrl(u), u).toBe(true);
    }
  });
});

describe("network and personal-data guards", () => {
  it("blocks non-http schemes", () => {
    for (const url of ["file:///proc/self/environ", "chrome://settings", "data:text/html,hi", "javascript:alert(1)"]) {
      expect(checkAction({ op: "goto", url }, { url: "about:blank" }).allowed, url).toBe(false);
    }
  });

  it("blocks private and internal hosts", () => {
    for (const url of [
      "http://llm:4000/v1/models",
      "http://search:8080/",
      "http://localhost:3000/",
      "http://127.0.0.1:8000/agui",
      "http://192.168.1.1/",
      "http://10.0.0.5/",
      "http://172.20.0.3/",
      "http://169.254.169.254/latest/meta-data",
      "http://host.docker.internal:11434/",
      "http://[::1]/",
    ]) {
      expect(checkAction({ op: "goto", url }, { url: "about:blank" }).allowed, url).toBe(false);
    }
  });

  it("allows private hosts only when explicitly enabled", () => {
    expect(checkAction({ op: "goto", url: "http://127.0.0.1:5000/" }, { url: "about:blank" }, { allowPrivateHosts: true })).toEqual({
      allowed: true,
    });
  });

  it("blocks booking, reservation and order flow urls", () => {
    for (const url of [
      "https://www.airline.com/booking/passengers",
      "https://hotel.example.com/reservations/new",
      "https://shop.example.com/order/review",
      "https://shop.example.com/purchase",
    ]) {
      expect(isBlockedUrl(url), url).toBe(true);
    }
  });

  it("blocks typing personal details", () => {
    const page = (target: object) => ({ url: "https://www.airline.com/flights/select", target });
    expect(checkAction({ op: "type", selector: "#e", value: "a@b.c" }, page({ type: "email" })).allowed).toBe(false);
    expect(checkAction({ op: "type", selector: "#p", value: "555" }, page({ type: "tel" })).allowed).toBe(false);
    expect(checkAction({ op: "type", selector: "#n", value: "Jo" }, page({ autocomplete: "given-name" })).allowed).toBe(false);
    expect(checkAction({ op: "type", selector: "#a", value: "1 Main" }, page({ autocomplete: "street-address" })).allowed).toBe(false);
  });

  it("still allows postal code entry", () => {
    expect(
      checkAction(
        { op: "type", selector: "#pin", value: "411001" },
        { url: "https://www.amazon.in/dp/x", target: { type: "text", autocomplete: "postal-code" } },
      ),
    ).toEqual({ allowed: true });
  });
});

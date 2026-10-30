import { describe, expect, it } from "vitest";
import { Evidence, extractClaims } from "../../src/grounding/evidence.js";

describe("extractClaims", () => {
  it("finds prices, ratings, stock phrases and links", () => {
    const claims = extractClaims(
      "Diyas are $6.99 (4.5 stars), ✅ In Stock at https://www.target.com/p/diya/-/A-1?x=1. Rs. 1,299 on Amazon.",
    );
    expect(claims.map((c) => [c.kind, c.text])).toEqual([
      ["price", "$6.99"],
      ["rating", "4.5 stars"],
      ["stock", "In Stock"],
      ["link", "https://www.target.com/p/diya/-/A-1?x=1"],
      ["price", "Rs. 1,299"],
    ]);
  });

  it("ignores plain numbers, quantities and temperatures", () => {
    expect(extractClaims("Invite 25 people, buy 3 kg sweets, it will be 72°F on 11/1.")).toEqual([]);
    expect(extractClaims("Price unavailable — the page was blocked.")).toEqual([]);
  });
});

describe("Evidence", () => {
  const ev = new Evidence();
  ev.add(
    'Target: Diwali Diya 12ct $6.99 · 4.5 out of 5 stars · In stock. https://www.target.com/p/diya/-/A-84311898 {"price":289,"rating":4.2}',
  );
  ev.add("My budget is about $200.");

  const unverified = (text: string) => ev.unverified(text);

  it("supports prices that appear in sources, regardless of formatting", () => {
    expect(unverified("Diyas cost 6.99 USD, flights from $289, budget $200.00")).toEqual([]);
  });

  it("flags prices that never appeared", () => {
    expect(unverified("Rangoli kit $7.49 and lanterns $5.99")).toEqual(["$7.49", "$5.99"]);
  });

  it("does not let a bare number back a price", () => {
    const e = new Evidence();
    e.add("Pack of 12 diyas, 5 colors");
    expect(e.unverified("$12")).toEqual(["$12"]);
  });

  it("checks ratings", () => {
    expect(unverified("rated 4.5/5")).toEqual([]);
    expect(unverified("rated 4.8 stars")).toEqual(["4.8 stars"]);
  });

  it("checks stock claims by family", () => {
    expect(unverified("✅ In Stock")).toEqual([]);
    expect(unverified("Sold out at Walmart")).toEqual(["Sold out"]);
  });

  it("checks links by host and path, ignoring query and trailing slash", () => {
    expect(unverified("https://target.com/p/diya/-/A-84311898/?ref=x")).toEqual([]);
    expect(unverified("https://www.target.com/p/made-up/-/A-1")).toEqual(["https://www.target.com/p/made-up/-/A-1"]);
    expect(ev.hasUrl("https://www.target.com/")).toBe(true);
  });

  it("reports each unverified claim once", () => {
    expect(unverified("$7.49 then again $7.49")).toEqual(["$7.49"]);
  });
});

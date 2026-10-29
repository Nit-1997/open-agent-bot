import { describe, expect, it } from "vitest";
import { parseJsonLd, structuredLines } from "../../src/sources/jsonld.js";
import { tileOf } from "../../src/sources/retail/jsonldStore.js";

const page = (...blocks: unknown[]) =>
  `<html><head>${blocks.map((b) => `<script type="application/ld+json">${typeof b === "string" ? b : JSON.stringify(b)}</script>`).join("\n")}</head><body>x</body></html>`;

const productGraph = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", name: "Shop", url: "https://shop.test/" },
    { "@type": "BreadcrumbList", itemListElement: [] },
    {
      "@type": "Product",
      "@id": "https://shop.test/p/xm5#product",
      name: "Sony WH-1000XM5 Wireless Headphones",
      url: "https://shop.test/p/xm5",
      image: ["https://shop.test/img/xm5.jpg", "https://shop.test/img/xm5b.jpg"],
      brand: { "@type": "Brand", name: "Sony" },
      aggregateRating: { "@type": "AggregateRating", ratingValue: "4.6", reviewCount: "1203" },
      offers: {
        "@type": "AggregateOffer",
        priceCurrency: "USD",
        lowPrice: "298.00",
        highPrice: "399.99",
        offerCount: 3,
        offers: [
          { "@type": "Offer", price: "398.00", priceCurrency: "USD", availability: "https://schema.org/OutOfStock" },
          { "@type": "Offer", price: "298.00", priceCurrency: "USD", availability: "https://schema.org/InStock" },
        ],
      },
    },
  ],
};

describe("parseJsonLd", () => {
  it("reads a product from an @graph with AggregateOffer and nested offers", () => {
    const [p] = parseJsonLd(page(productGraph), "https://shop.test/p/xm5");
    expect(p).toMatchObject({
      kind: "product",
      name: "Sony WH-1000XM5 Wireless Headphones",
      url: "https://shop.test/p/xm5",
      image: "https://shop.test/img/xm5.jpg",
      brand: "Sony",
      price: 298,
      highPrice: 399.99,
      currency: "USD",
      availability: "InStock",
      offerCount: 3,
      rating: 4.6,
      reviews: 1203,
    });
  });

  it("reads a plain Offer array with a priceSpecification and a locale-formatted price", () => {
    const [p] = parseJsonLd(
      page([{ "@type": ["Product", "Thing"], name: "Phone", image: { "@type": "ImageObject", url: "/i.jpg" }, offers: [{ "@type": "Offer", priceSpecification: { price: "29.999,00", priceCurrency: "INR" }, availability: "InStock" }] }]),
      "https://shop.in/p/1",
    );
    expect(p).toMatchObject({ price: 29999, currency: "INR", image: "https://shop.in/i.jpg" });
  });

  it("reads product variants from a ProductGroup", () => {
    const rs = parseJsonLd(
      page({ "@type": "ProductGroup", name: "Tee", hasVariant: [{ "@type": "Product", name: "Tee S", offers: { price: 10, priceCurrency: "USD" } }, { "@type": "Product", name: "Tee M", offers: { price: 12, priceCurrency: "USD" } }] }),
    );
    expect(rs.map((r) => [r.name, r.price])).toEqual([["Tee S", 10], ["Tee M", 12]]);
  });

  it("reads hotels, restaurants and events", () => {
    const rs = parseJsonLd(
      page(
        { "@type": "Hotel", name: "Grand", address: { "@type": "PostalAddress", streetAddress: "1 Main St", addressLocality: "Reno", addressRegion: "NV" }, priceRange: "$$", aggregateRating: { ratingValue: 4.2, ratingCount: 88 } },
        { "@type": "Restaurant", name: "Bistro", servesCuisine: ["French", "Vegetarian"], telephone: "+1 555 0100" },
        { "@type": "MusicEvent", name: "Gig", startDate: "2026-12-01T20:00", location: { "@type": "Place", name: "The Hall", address: "9 Elm" }, offers: { price: 45, priceCurrency: "USD" } },
      ),
    );
    expect(rs[0]).toMatchObject({ kind: "lodging", address: "1 Main St, Reno, NV", priceRange: "$$", rating: 4.2, reviews: 88 });
    expect(rs[1]).toMatchObject({ kind: "restaurant", cuisine: "French, Vegetarian", telephone: "+1 555 0100" });
    expect(rs[2]).toMatchObject({ kind: "event", startDate: "2026-12-01T20:00", location: "The Hall, 9 Elm", price: 45 });
  });

  it("reads products from an ItemList and skips broken blocks", () => {
    const rs = parseJsonLd(
      page("{ not json", { "@type": "ItemList", itemListElement: [{ "@type": "ListItem", position: 1, item: { "@type": "Product", name: "A", url: "https://s.test/a", offers: { price: 1, priceCurrency: "USD" } } }, { "@type": "ListItem", position: 2, item: { "@type": "Product", name: "B", offers: { price: 2 } } }] }),
    );
    expect(rs.map((r) => r.name)).toEqual(["A", "B"]);
  });

  it("returns nothing for pages without structured data", () => {
    expect(parseJsonLd("<html><body>hi</body></html>")).toEqual([]);
  });

  it("formats compact structured lines", () => {
    const lines = structuredLines(parseJsonLd(page(productGraph)));
    expect(lines).toEqual(["- product: Sony WH-1000XM5 Wireless Headphones — USD 298-399.99, InStock, 4.6/5 (1203 reviews), brand Sony"]);
  });
});

describe("tileOf", () => {
  it("turns a priced product into a tile and flags out-of-stock without a price", () => {
    const [p] = parseJsonLd(page(productGraph), "https://shop.test/p/xm5");
    expect(tileOf(p, "https://shop.test/p/xm5")).toMatchObject({ title: "Sony WH-1000XM5 Wireless Headphones", price: 298, priceText: "$298.00", url: "https://shop.test/p/xm5", rating: 4.6 });
    const out = tileOf({ kind: "product", name: "Gone", price: 5, currency: "USD", availability: "OutOfStock" }, "https://s.test/g");
    expect(out?.price).toBeUndefined();
    expect(out?.priceText).toBe("$5.00 (out of stock)");
    expect(tileOf({ kind: "event", name: "Gig" }, "https://s.test")).toBeNull();
  });
});

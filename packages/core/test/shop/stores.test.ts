import { describe, expect, it } from "vitest";
import { defaultStoresFor, storeFor } from "../../src/shop/stores.js";

describe("storeFor", () => {
  it("maps names and domains to the same store", () => {
    for (const s of ["Target", "target.com", "https://www.target.com/", " TARGET "]) expect(storeFor(s).id).toBe("target");
    expect(storeFor("Best Buy").id).toBe("bestbuy");
  });

  it("builds each store's search address with the query encoded", () => {
    expect(storeFor("amazon").searchUrl!("black beans & rice")).toBe("https://www.amazon.com/s?k=black%20beans%20%26%20rice");
    expect(storeFor("shipt").searchUrl!("diet coke")).toBe("https://www.shipt.com/shop/stores/search?query=diet%20coke&searchType=typed");
  });

  it("marks Shipt as a marketplace whose sections are stores", () => {
    const s = storeFor("Shipt");
    expect(s.marketplace).toBe(true);
    expect(s.groupFromHref).toBeDefined();
  });

  it("uses the site's own search box for stores it doesn't know", () => {
    const s = storeFor("www.rei.com");
    expect(s).toMatchObject({ id: "rei.com", label: "rei.com", home: "https://www.rei.com/" });
    expect(s.searchUrl).toBeUndefined();
  });
});

describe("defaultStoresFor", () => {
  it("picks stores by region and kind", () => {
    expect(defaultStoresFor("US", "grocery")).toEqual(["shipt"]);
    expect(defaultStoresFor("US", "general")).toEqual(["amazon", "target"]);
    expect(defaultStoresFor("IN", "general")).toEqual(["amazon.in", "flipkart"]);
    expect(defaultStoresFor("GB", "grocery")).toEqual(["amazon.co.uk"]);
  });

  it("returns stores that resolve to the right sites", () => {
    expect(storeFor("amazon.in").home).toBe("https://www.amazon.in/");
    expect(storeFor("amazon.co.uk").searchUrl!("tea")).toBe("https://www.amazon.co.uk/s?k=tea");
    expect(storeFor("flipkart").home).toBe("https://www.flipkart.com/");
    expect(storeFor("amazon.com").id).toBe("amazon");
  });
});

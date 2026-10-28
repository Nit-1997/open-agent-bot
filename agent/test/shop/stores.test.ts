import { describe, expect, it } from "vitest";
import { storeFor } from "../../src/shop/stores.js";

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

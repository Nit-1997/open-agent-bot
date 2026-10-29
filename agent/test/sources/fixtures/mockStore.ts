import type { RetailSource } from "../../../src/sources/retail/types.js";

export const mockStore: RetailSource = {
  id: "mockmart",
  label: "Mock Mart",
  home: "https://mockmart.test/",
  vertical: "retail",
  regions: ["NZ"],
  capabilities: ["search", "price"],
  defaultFor: ["NZ"],
  domains: ["mockmart.test"],
  async search(q) {
    return { tiles: [{ title: `${q.query} at Mock Mart`, price: 9.5, priceText: "$9.50", url: "https://mockmart.test/p/1", sponsored: false }] };
  },
};

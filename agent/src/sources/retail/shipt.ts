import { browserStore } from "./browser.js";

export const shipt = browserStore({
  id: "shipt",
  label: "Shipt",
  home: "https://www.shipt.com/",
  searchUrl: (s) => `https://www.shipt.com/shop/stores/search?query=${encodeURIComponent(s)}&searchType=typed`,
  marketplace: true,
  groupSelector: 'a[href*="/shop/"][href*="/search"]',
  groupFromHref: "/shop/([^/]+)/search",
  scrolls: 6,
  regions: ["US"],
  capabilities: ["search", "price", "grocery"],
  defaultFor: ["US:grocery"],
  note: "compares the nearby stores it carries",
});

import { browserStore } from "./browser.js";

const q = encodeURIComponent;

const amazon = browserStore({
  id: "amazon",
  label: "Amazon",
  home: "https://www.amazon.com/",
  searchUrl: (s) => `https://www.amazon.com/s?k=${q(s)}`,
  regions: ["*"],
  defaultFor: ["US:general", "*"],
});

const amazonIndia = browserStore({
  id: "amazon.in",
  label: "Amazon India",
  home: "https://www.amazon.in/",
  searchUrl: (s) => `https://www.amazon.in/s?k=${q(s)}`,
  domains: ["amazon.in"],
  regions: ["IN"],
  defaultFor: ["IN"],
});

const amazonUk = browserStore({
  id: "amazon.co.uk",
  label: "Amazon UK",
  home: "https://www.amazon.co.uk/",
  searchUrl: (s) => `https://www.amazon.co.uk/s?k=${q(s)}`,
  domains: ["amazon.co.uk"],
  regions: ["GB", "IE"],
  defaultFor: ["GB"],
});

const flipkart = browserStore({
  id: "flipkart",
  label: "Flipkart",
  home: "https://www.flipkart.com/",
  searchUrl: (s) => `https://www.flipkart.com/search?q=${q(s)}`,
  regions: ["IN"],
  defaultFor: ["IN"],
});

const target = browserStore({
  id: "target",
  label: "Target",
  home: "https://www.target.com/",
  searchUrl: (s) => `https://www.target.com/s?searchTerm=${q(s)}`,
  regions: ["US"],
  defaultFor: ["US:general"],
});

const walmart = browserStore({
  id: "walmart",
  label: "Walmart",
  home: "https://www.walmart.com/",
  searchUrl: (s) => `https://www.walmart.com/search?q=${q(s)}`,
  regions: ["US"],
});

const costco = browserStore({
  id: "costco",
  label: "Costco",
  home: "https://www.costco.com/",
  searchUrl: (s) => `https://www.costco.com/s?keyword=${q(s)}`,
  regions: ["US", "CA"],
});

const bestbuy = browserStore({
  id: "bestbuy",
  label: "Best Buy",
  home: "https://www.bestbuy.com/",
  searchUrl: (s) => `https://www.bestbuy.com/site/searchpage.jsp?st=${q(s)}`,
  aliases: ["best buy", "best-buy"],
  regions: ["US"],
});

const kroger = browserStore({
  id: "kroger",
  label: "Kroger",
  home: "https://www.kroger.com/",
  searchUrl: (s) => `https://www.kroger.com/search?query=${q(s)}`,
  regions: ["US"],
  capabilities: ["search", "price", "grocery"],
});

const safeway = browserStore({
  id: "safeway",
  label: "Safeway",
  home: "https://www.safeway.com/",
  searchUrl: (s) => `https://www.safeway.com/shop/search-results.html?q=${q(s)}`,
  regions: ["US"],
  capabilities: ["search", "price", "grocery"],
});

export const SIMPLE_STORES = [amazon, amazonIndia, amazonUk, flipkart, target, walmart, costco, bestbuy, kroger, safeway];

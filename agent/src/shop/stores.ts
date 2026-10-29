export type Store = {
  id: string;
  label: string;
  home: string;
  searchUrl?: (q: string) => string;
  marketplace?: boolean;
  groupSelector?: string;
  groupFromHref?: string;
  scrolls?: number;
};

const q = encodeURIComponent;

const KNOWN: Store[] = [
  {
    id: "shipt",
    label: "Shipt",
    home: "https://www.shipt.com/",
    searchUrl: (s) => `https://www.shipt.com/shop/stores/search?query=${q(s)}&searchType=typed`,
    marketplace: true,
    groupSelector: 'a[href*="/shop/"][href*="/search"]',
    groupFromHref: "/shop/([^/]+)/search",
    scrolls: 6,
  },
  { id: "amazon", label: "Amazon", home: "https://www.amazon.com/", searchUrl: (s) => `https://www.amazon.com/s?k=${q(s)}` },
  { id: "amazon.in", label: "Amazon India", home: "https://www.amazon.in/", searchUrl: (s) => `https://www.amazon.in/s?k=${q(s)}` },
  { id: "amazon.co.uk", label: "Amazon UK", home: "https://www.amazon.co.uk/", searchUrl: (s) => `https://www.amazon.co.uk/s?k=${q(s)}` },
  { id: "flipkart", label: "Flipkart", home: "https://www.flipkart.com/", searchUrl: (s) => `https://www.flipkart.com/search?q=${q(s)}` },
  { id: "target", label: "Target", home: "https://www.target.com/", searchUrl: (s) => `https://www.target.com/s?searchTerm=${q(s)}` },
  { id: "walmart", label: "Walmart", home: "https://www.walmart.com/", searchUrl: (s) => `https://www.walmart.com/search?q=${q(s)}` },
  { id: "costco", label: "Costco", home: "https://www.costco.com/", searchUrl: (s) => `https://www.costco.com/s?keyword=${q(s)}` },
  { id: "bestbuy", label: "Best Buy", home: "https://www.bestbuy.com/", searchUrl: (s) => `https://www.bestbuy.com/site/searchpage.jsp?st=${q(s)}` },
  { id: "kroger", label: "Kroger", home: "https://www.kroger.com/", searchUrl: (s) => `https://www.kroger.com/search?query=${q(s)}` },
  { id: "safeway", label: "Safeway", home: "https://www.safeway.com/", searchUrl: (s) => `https://www.safeway.com/shop/search-results.html?q=${q(s)}` },
];

const ALIASES: Record<string, string> = { "best buy": "bestbuy", "best-buy": "bestbuy" };

export function storeFor(input: string): Store {
  const raw = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const exact = KNOWN.find((s) => s.id === raw);
  if (exact) return exact;
  const name = ALIASES[raw] ?? raw.replace(/\.(com|co\.uk|ca|in)$/, "").replace(/\s+/g, "");
  const known = KNOWN.find((s) => s.id === name);
  if (known) return known;
  const domain = raw.includes(".") ? raw : `${name}.com`;
  return { id: domain, label: domain, home: `https://www.${domain}/` };
}

export type StoreKind = "grocery" | "general";

export function defaultStoresFor(country: string, kind: StoreKind): string[] {
  switch (country.toUpperCase()) {
    case "US":
      return kind === "grocery" ? ["shipt"] : ["amazon", "target"];
    case "IN":
      return ["amazon.in", "flipkart"];
    case "GB":
      return ["amazon.co.uk"];
    default:
      return ["amazon"];
  }
}

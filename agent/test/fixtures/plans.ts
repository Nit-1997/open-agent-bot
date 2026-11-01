import type { CartEntity, TripEntity } from "../../../shared/workspace.js";

export const tripValue: TripEntity = {
  destination: "Big Sur",
  start: "2026-11-14",
  end: "2026-11-16",
  travelers: 2,
  budget: 900,
  stays: [{ name: "Ripplewood cabin", url: "https://ripplewood.example/" }],
  days: [{ date: "2026-11-14", items: ["McWay Falls at sunset"] }],
};

const pick = (title: string, price: number) => ({ title, price, url: `https://www.traderjoes.com/p/${encodeURIComponent(title)}` });

export const cartValue: CartEntity = {
  stores: ["traderjoes"],
  scope: ["Trader Joe's"],
  items: [
    { query: "tortillas", qty: 2 },
    { query: "black beans", qty: 4 },
  ],
  homes: { "Trader Joe's": "https://www.traderjoes.com/" },
  picks: { "Trader Joe's": { tortillas: [pick("Corn tortillas", 2.99)], "black beans": [pick("Black beans", 1.19)] } },
};

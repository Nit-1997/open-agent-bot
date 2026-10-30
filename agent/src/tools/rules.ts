import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { defaultStoresFor, storeFor } from "../shop/stores.js";

export function withRules<T extends ToolDefinition<any, any, any>>(tool: T, rules: string | ((base: string) => string), drop?: string): T {
  const base = drop ? tool.description.replace(`\n\n${drop}`, "") : tool.description;
  return { ...tool, description: typeof rules === "function" ? rules(base) : `${base}\n\n${rules}` };
}

const list = (ids: string[]) => ids.join(", ");

export const RULES = {
  weather:
    "Never repeat its numbers in another card, table, or list. Typical weather for far-off dates is not a forecast: call it typical.",
  flights: () =>
    "Search flights and show one flight card with links for the user to book themselves. Dates are YYYY-MM-DD. from is an airport code or city, up to 4 codes separated by commas, or \"nearby\" for every airport near the user's home: use nearby when they fly from home, unless they chose the closest only. The card ranks airports by fare plus an estimated rideshare. Pass layover and departure-time preferences when known. Then explain the best value in a sentence and point to the search link; don't ask which airport or offer driving.",
  stays:
    'Call it once; type "rental" for homes and apartments, "hotel" for hotels. Don\'t browse booking sites or repeat its listings in show_ui. Then name the best one or two picks in a sentence.',
  askUser:
    "Use it once when a trip, event, or purchase depends on details not given (dates, travelers or guests, starting city, budget), then end your reply; don't search until they answer, and don't ask for what they gave.",
  showUi:
    "Call it once per answer. Picture-recognizable things (products, albums, books, hotels, places, restaurants, articles) go in a cards block, not a list, even when some lack an image or link. A shopping list is one card per item; a checklist is only for steps. A single product you found is also a card. Never repeat what flights, weather, stays, or shop show. On a validation error, fix the fields and retry once, else answer in text.",
  imageSearch:
    'Prefer image URLs from "images:" in pages you read or from music, wikipedia, or search; use this only for items still missing one (hotels, restaurants).',
  createArtifact:
    "Use for research reports, printable plans, and any page or PDF the user asks for. Before writing the HTML, call load_skill research: it has the report kit classes the page is styled with.",
};

export function shopRules(country: string): (base: string) => string {
  return (base) => {
    const at = base.indexOf("Stores");
    const stores = at < 0 ? "" : ` ${base.slice(at)}`;
    const market = defaultStoresFor(country, "grocery").find((id) => storeFor(id).marketplace);
    const viaMarket = market
      ? ` Groceries from a store ${market} carries: pass ${market}, which reads that store's real prices; the store's own site usually blocks guests.`
      : "";
    return `Build the chat's one shopping cart from stores' real catalogs, browsing as a guest. First call: items with qty and 1-3 stores; it keeps the best-value stores. For follow-ups ("add tortillas", "make it for 6") pass only the new items, no stores. remove drops items; pass stores again only to switch stores, new_cart only for an unrelated list. Use the store the user named, else the defaults for their region: groceries ${list(defaultStoresFor(country, "grocery"))}; other products ${list(defaultStoresFor(country, "general"))}.${viaMarket}${stores}

It shows its own cart card (products, prices, links, best value), so don't repeat products in show_ui and never use image_search pictures for products. For recipes skip pantry basics. Reply in a sentence or two: best-value store, how much cheaper than the next, missing items.`;
  };
}

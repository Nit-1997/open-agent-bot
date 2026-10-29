import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { defaultStoresFor } from "../shop/stores.js";

export function withRules<T extends ToolDefinition<any, any, any>>(tool: T, rules: string, on: boolean, drop?: string): T {
  if (!on) return tool;
  const base = drop ? tool.description.replace(`\n\n${drop}`, "") : tool.description;
  return { ...tool, description: `${base}\n\n${rules}` };
}

const list = (ids: string[]) => ids.join(", ");

export const RULES = {
  weather: "Never repeat its numbers in another card, table, or list. Typical weather for far-off dates is not a forecast: call it typical.",
  flights:
    'Shows its own card: summarize the best options in a sentence and point to the search link. For flights from where the user lives pass from "nearby" to search every airport near their home in one call, unless they chose the closest only (then pass that airport). The card ranks airports by fare plus an estimated rideshare; explain the best value. Don\'t ask which airport, and don\'t offer driving.',
  stays:
    'Call it once with area, dates, guests, and nightly budget as max_price; type "rental" for homes and apartments, "hotel" for hotels. Don\'t browse booking sites or repeat its listings in show_ui. Then name the best one or two picks in a sentence.',
  askUser:
    "Use it once when a trip, event, or purchase depends on details not given (dates, travelers or guests, starting city, budget), then end your reply; don't search until they answer, and don't ask for what they gave.",
  showUi:
    "Call it once per answer. Picture-recognizable things (products, albums, books, hotels, places, restaurants, articles) go in a cards block, not a list, even when some lack an image or link. A shopping list is one card per item; a checklist is only for steps. A single product you found is also a card. Never repeat what flights, weather, stays, or shop show. On a validation error, fix the fields and retry once, else answer in text.",
  imageSearch:
    'Prefer image URLs from "images:" in pages you read or from music, wikipedia, or search; use this for items still missing one (hotels, restaurants). Never for products shop returns. For a quick overview, start the card with an image block from here.',
  createArtifact:
    "Use for research reports, printable plans, and any page or PDF the user asks for. Before writing the HTML, call load_skill research: it has the report kit classes the page is styled with.",
};

export function shopRules(country: string): string {
  return `For follow-ups ("add tortillas", "make it for 6") pass only the new items, no stores. Use the store the user named, else the defaults for their region: groceries ${list(defaultStoresFor(country, "grocery"))}; other products ${list(defaultStoresFor(country, "general"))}. It shows its own cart card, so don't repeat products in show_ui and never use image_search pictures for products. For recipes skip pantry basics. Reply in a sentence or two: best-value store, how much cheaper than the next, missing items.`;
}

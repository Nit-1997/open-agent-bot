import type { ScoreCriteria } from "../index.js";

type MatchLevel = "exact" | "substitute" | "complement" | "irrelevant";

export const productMatch: ScoreCriteria<MatchLevel> = {
  id: "productMatch",
  version: "2",
  question: "A shopper searched a store catalog for the query. How well does this catalog product satisfy that search?",
  levels: {
    exact: {
      means: "The product is what the shopper asked for: the same kind of item, with every attribute they named (brand, flavor, type, variety, size, count, dietary claim) matching or not contradicted. A brand named in the query must be the product's brand. Pack sizes and unnamed details may differ.",
      not: "A different kind of item, a different flavor or variety than named, an accessory or ingredient for the item, or a product that contradicts a named attribute.",
    },
    substitute: {
      means: "The product is not quite what was asked for but would serve the same purpose for the shopper, such as a similar item of the same kind with a different brand, flavor, size or variety that was not specified as required.",
      not: "The exact item, something that goes with the item rather than replacing it, or something that serves a different purpose.",
    },
    complement: {
      means: "The product is used together with the item the shopper wants, such as a topping, accessory, container, or companion product, but does not replace it.",
      not: "The item itself, a replacement for it, or something unrelated to it.",
    },
    irrelevant: {
      means: "The product has nothing to do with the search: a different category, or only shares a word with the query.",
      not: "The item, a replacement for the item, or something used together with it.",
    },
  },
};

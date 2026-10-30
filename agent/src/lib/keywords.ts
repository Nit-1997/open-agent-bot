const FILLER = new Set([
  "a",
  "an",
  "the",
  "of",
  "or",
  "and",
  "with",
  "for",
  "lb",
  "lbs",
  "oz",
  "fl",
  "ct",
  "pk",
  "pack",
  "bag",
  "box",
  "can",
  "canned",
  "jar",
  "bottle",
  "packet",
  "packets",
  "bunch",
  "fresh",
  "about",
]);

export const keyWords = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z\s]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !FILLER.has(w))
    .map((w) => w.replace(/(es|s)$/, ""));

import type { YesNoCriteria } from "../index.js";

export const claimSupported: YesNoCriteria = {
  id: "claimSupported",
  version: "1",
  question: "Source is the text of a web page. Does the source text support the claim?",
  yes: "The source states the claim, or it follows directly from what the source says. Every number, price, spec and comparison in the claim agrees with the source.",
  no: "The source does not mention the claim, says something different, or gives a different number, price, spec or ranking than the claim.",
};

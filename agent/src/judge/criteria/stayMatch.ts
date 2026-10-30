import type { YesNoCriteria } from "../index.js";

const STAY_MATCH_VERSION = "1";

const stayBrand: YesNoCriteria = {
  id: "stayBrand",
  version: STAY_MATCH_VERSION,
  question: "A traveler wants a hotel from one of the brands listed in brands. Is this listing a property of one of those brands or their sub-brands?",
  yes: "The listing is a hotel operated or branded by one of the listed brands or one of their sub-brands, such as Courtyard, Westin, Sheraton, Ritz-Carlton or Moxy for Marriott, and Park Hyatt, Andaz, Grand Hyatt or Hyatt Regency for Hyatt.",
  no: "An independent hotel, a different chain, a rental or apartment, or a name that only sounds similar to a listed brand.",
};

const stayArea: YesNoCriteria = {
  id: "stayArea",
  version: STAY_MATCH_VERSION,
  question: "A traveler wants to stay in or near the place named in area, within the city in location. Is this listing in or near that place?",
  yes: "The listing is inside the named neighborhood or district, or within an easy walk of the named landmark, or the listing's own name or area says it is there.",
  no: "The listing is in a different part of the city or far from the named place, or nothing in the listing places it there.",
};

const stayVibe: YesNoCriteria = {
  id: "stayVibe",
  version: STAY_MATCH_VERSION,
  question: "A traveler wants a stay with the character described in vibe. Does this listing fit it?",
  yes: "The listing's name, type, area or badge clearly suggests the described character.",
  no: "The listing suggests a different character, or nothing about it supports the described one.",
};

export const stayMatch = { brand: stayBrand, area: stayArea, vibe: stayVibe };

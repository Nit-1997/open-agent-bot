import { describe, expect, it } from "vitest";
import { emptyProfile, type Profile } from "@oab/shared/profile";
import { shopDefaults, staysDefaults } from "../../src/profile/defaults.js";
import { createRegistry } from "../../src/sources/index.js";
import { STAY_SOURCES } from "../../src/sources/stays/index.js";

const regional = (kind: "grocery" | "general") => (kind === "grocery" ? ["shipt"] : ["amazon", "target"]);
const withShopping = (s: Partial<Profile["shopping"]>): Profile => ({ ...emptyProfile(), shopping: { ...emptyProfile().shopping, ...s } });

describe("shopDefaults", () => {
  it("puts the user's stores that have a reader first, then the regional defaults", () => {
    const p = withShopping({ groceries: ["Trader Joe's", "Safeway", "Costco"], retail: ["Best Buy", "IKEA"] });
    expect(shopDefaults(p, "US", createRegistry(), regional)).toEqual({
      grocery: ["safeway", "costco", "shipt"],
      general: ["bestbuy", "amazon", "target"],
    });
  });

  it("uses the regional defaults with no profile, and skips stores outside the region", () => {
    expect(shopDefaults(undefined, "US", createRegistry(), regional)).toEqual({ grocery: ["shipt"], general: ["amazon", "target"] });
    expect(shopDefaults(withShopping({ retail: ["Flipkart"] }), "US", createRegistry(), regional).general).toEqual(["amazon", "target"]);
  });
});

describe("staysDefaults", () => {
  it("uses the stay type, only the chosen searched sites, and hotel chains as the brand wish", () => {
    const p: Profile = {
      ...emptyProfile(),
      travel: { airlines: [], stays: ["rental"], hotelChains: ["Marriott", "Independent"], sites: ["Airbnb", "Expedia", "Kayak"] },
    };
    expect(staysDefaults(p, STAY_SOURCES)).toEqual({ type: "rental", sources: ["airbnb"], brands: ["Marriott"] });
  });

  it("searches everything when nothing or both stay types were chosen", () => {
    expect(staysDefaults(undefined, STAY_SOURCES)).toEqual({ type: "any", sources: [], brands: [] });
    const both: Profile = { ...emptyProfile(), travel: { ...emptyProfile().travel, stays: ["hotel", "rental"] } };
    expect(staysDefaults(both, STAY_SOURCES).type).toBe("any");
  });
});

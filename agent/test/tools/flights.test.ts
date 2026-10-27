import { describe, expect, it } from "vitest";
import { currencyForLocale, flightsTool, googleFlightsUrl } from "../../src/tools/flights.js";
import { ok } from "../../src/tools/result.js";

describe("flights", () => {
  it("builds google flights url with date and currency from en-IN → INR", () => {
    const u = new URL(googleFlightsUrl({ from: "SFO", to: "BLR", date: "2026-12-15" }, "en-IN"));
    expect(u.origin + u.pathname).toBe("https://www.google.com/travel/flights");
    expect(u.searchParams.get("q")).toBe("Flights from SFO to BLR on 2026-12-15 one way");
    expect(u.searchParams.get("curr")).toBe("INR");
    expect(u.searchParams.get("hl")).toBe("en-IN");
  });

  it("includes return date and adults", () => {
    const u = new URL(googleFlightsUrl({ from: "SFO", to: "BLR", date: "2026-12-15", returnDate: "2027-01-05", adults: 2 }, "en-US"));
    expect(u.searchParams.get("q")).toBe("Flights from SFO to BLR on 2026-12-15 returning 2027-01-05 for 2 adults");
    expect(u.searchParams.get("curr")).toBe("USD");
  });

  it("maps locales to currencies with USD fallback", () => {
    expect(currencyForLocale("en-GB")).toBe("GBP");
    expect(currencyForLocale("de-DE")).toBe("EUR");
    expect(currencyForLocale("xx")).toBe("USD");
  });

  it("result text starts with searchUrl", async () => {
    const seen: unknown[] = [];
    const tool = flightsTool({
      locale: "en-IN",
      browse: async (actions) => {
        seen.push(actions);
        return ok("url: x\n\nAir India 21:00 – 04:30 ₹92,000");
      },
    });
    const r = await tool.execute("c", { from: "SFO", to: "BLR", date: "2026-12-15" }, undefined, undefined, {} as never);
    const t = (r.content[0] as { text: string }).text;
    expect(t.startsWith("searchUrl: https://www.google.com/travel/flights?")).toBe(true);
    expect(t).toContain("Air India");
    expect(seen[0]).toEqual([{ op: "goto", url: expect.stringContaining("google.com/travel/flights") }, { op: "wait", ms: 3000 }, { op: "read" }]);
  });

  it("rejects malformed dates", async () => {
    const tool = flightsTool({ locale: "en-US", browse: async () => ok("") });
    const r = await tool.execute("c", { from: "SFO", to: "BLR", date: "Dec 15" }, undefined, undefined, {} as never);
    expect(r.isError).toBe(true);
  });
});

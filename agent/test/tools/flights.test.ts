import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateWidget } from "../../../shared/widgets.js";
import { flightsTool, googleFlightsUrl, parseGoogleFlights } from "../../src/tools/flights.js";
import { renderData } from "../../src/render/registry.js";
import { ok } from "../../src/tools/result.js";

const page = readFileSync(new URL("../fixtures/google-flights-sfo-bna.txt", import.meta.url), "utf8");

describe("googleFlightsUrl", () => {
  it("uses the given currency and language", () => {
    const u = new URL(googleFlightsUrl({ from: "SFO", to: "BLR", date: "2026-12-15" }, "en-IN", "USD"));
    expect(u.origin + u.pathname).toBe("https://www.google.com/travel/flights");
    expect(u.searchParams.get("q")).toBe("Flights from SFO to BLR on 2026-12-15 one way");
    expect(u.searchParams.get("curr")).toBe("USD");
    expect(u.searchParams.get("hl")).toBe("en-IN");
  });

  it("includes return date and adults", () => {
    const u = new URL(googleFlightsUrl({ from: "SFO", to: "BLR", date: "2026-12-15", returnDate: "2027-01-05", adults: 2 }, "en-US", "USD"));
    expect(u.searchParams.get("q")).toBe("Flights from SFO to BLR on 2026-12-15 returning 2027-01-05 for 2 adults");
  });
});

describe("parseGoogleFlights", () => {
  it("extracts options from real page text", () => {
    const flights = parseGoogleFlights(page);
    expect(flights.length).toBeGreaterThanOrEqual(2);
    expect(flights[0]).toEqual({
      airline: "Delta",
      departTime: "6:00 AM",
      arriveTime: "2:17 PM",
      duration: "6 hr 17 min",
      stops: 1,
      layoverMinutes: 61,
      layoverAt: "SLC",
      price: 177,
    });
    expect(flights[1]).toMatchObject({ airline: "American", departTime: "8:55 AM", stops: 1, layoverMinutes: 55, layoverAt: "DFW", price: 177 });
  });

  it("parses nonstop, next-day arrivals, lowercase am/pm and other currency symbols", () => {
    const text = "9:05 pm – 6:10 am+1\nAir India\n\n16 hr 35 min\n\nNonstop\n\n₹92,450\n";
    expect(parseGoogleFlights(text)).toEqual([
      { airline: "Air India", departTime: "9:05 pm", arriveTime: "6:10 am+1", duration: "16 hr 35 min", stops: 0, price: 92450 },
    ]);
  });

  it("parses the en-IN page variant (hrs, lowercase am/pm)", () => {
    const pageIn = readFileSync(new URL("../fixtures/google-flights-sfo-bna-en-in.txt", import.meta.url), "utf8");
    expect(parseGoogleFlights(pageIn)[0]).toMatchObject({ airline: "Delta", departTime: "6:00 am", arriveTime: "2:17 pm", duration: "6 hrs 17 min", stops: 1, price: 177 });
  });

  it("drops the operated-by suffix from airline names", () => {
    const text = "12:45 am – 9:41 am\nUnitedOperated by Mesa Airlines DBA United Express\n\n6 hrs 56 min\n\n1 stop\n\n$177\n";
    expect(parseGoogleFlights(text)[0].airline).toBe("United");
  });

  it("returns nothing for unrelated text", () => {
    expect(parseGoogleFlights("Access denied")).toEqual([]);
  });
});

describe("flights tool", () => {
  const run = (text: string, details: Record<string, unknown> = {}) =>
    flightsTool({ locale: "en-IN", currency: "USD", browse: async () => ({ ...ok(text), details }) }).execute(
      "c",
      { from: "SFO", to: "BNA", date: "2026-12-12" },
      undefined,
      undefined,
      {} as never,
    );

  it("returns flights data in USD with the search link and a compact summary for the model", async () => {
    const r = await run(page);
    const t = (r.content[0] as { text: string }).text;
    expect(t.startsWith("searchUrl: https://www.google.com/travel/flights?")).toBe(true);
    expect(t).toContain("(Note for you, do not repeat to the user: a flight card with these options and the booking link is already displayed.)");
    expect(t).toContain("Delta 6:00 AM – 2:17 PM, 6 hr 17 min, 1 stop (1h 1m in SLC), 177 USD");
    const data = (r.details as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ kind: "flights", from: "SFO", to: "BNA", date: "2026-12-12", currency: "USD", source: "Google Flights" });
    expect(String(data.searchUrl)).toContain("curr=USD");
    expect(validateWidget(renderData(data)).ok).toBe(true);
  });

  it("still returns data with the search link when no options parse", async () => {
    const r = await run("Some page with no flights");
    expect((r.details as { data: { options: unknown[] } }).data.options).toEqual([]);
  });

  it("returns no data when the site blocked the browser", async () => {
    const r = await run("blocked by www.google.com: https://...", { blocked: true });
    expect((r.details as { data?: unknown }).data).toBeUndefined();
  });

  it("searches nearby airports at the same time, each in its own tab, streaming only the first", async () => {
    const calls: Array<{ fresh?: boolean; live?: boolean }> = [];
    let inFlight = 0;
    let peak = 0;
    const browse = async (_a: unknown, opts: { fresh?: boolean; live?: boolean } = {}) => {
      calls.push(opts);
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return ok(page);
    };
    await flightsTool({ locale: "en-US", currency: "USD", browse }).execute("c", { from: "SJC, SFO, OAK", to: "BNA", date: "2026-12-12" }, undefined, undefined, {} as never);
    expect(peak).toBe(3);
    expect(calls.every((c) => c.fresh)).toBe(true);
    expect(calls.filter((c) => c.live)).toHaveLength(1);
  });

  it("rejects malformed dates", async () => {
    const r = await flightsTool({ locale: "en-US", currency: "USD", browse: async () => ok("") }).execute(
      "c",
      { from: "SFO", to: "BLR", date: "Dec 15" },
      undefined,
      undefined,
      {} as never,
    );
    expect(r.isError).toBe(true);
  });
});

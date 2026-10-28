import { describe, expect, it } from "vitest";
import { validateWidget } from "../../../shared/widgets.js";
import { renderData } from "../../src/render/registry.js";
import { type AirportResult, flightsTool, priceBasis, rankAirports } from "../../src/tools/flights.js";
import { AIRPORTS, milesBetween, rideshareRoundTrip } from "../../src/tools/geo.js";
import { fail, ok } from "../../src/tools/result.js";

const SUNNYVALE = { lat: 37.3688, lon: -122.0363 };

const option = (depart: string, arrive: string, airline: string, price: number) =>
  `${depart} – ${arrive}\n${airline}\n\n3 hrs 5 min\n\n1 stop\n\n$${price}\n`;
const pageWith = (...opts: string[]) => `Round trip\n${opts.join("\n")}\nPrices include required taxes + fees for 2 adults. Optional charges may apply.\n`;

describe("geo", () => {
  it("knows the Bay Area airports and their distance from Sunnyvale", () => {
    expect(Math.round(milesBetween(SUNNYVALE, AIRPORTS.SJC))).toBeLessThan(10);
    expect(Math.round(milesBetween(SUNNYVALE, AIRPORTS.SFO))).toBeGreaterThan(20);
    expect(milesBetween(SUNNYVALE, AIRPORTS.OAK)).toBeGreaterThan(milesBetween(SUNNYVALE, AIRPORTS.SJC));
  });

  it("estimates a round-trip rideshare to the airport, rounded to $5", () => {
    expect(rideshareRoundTrip(6)).toBe(45);
    expect(rideshareRoundTrip(25)).toBe(135);
  });
});

describe("priceBasis", () => {
  it("reads what the page says the prices cover", () => {
    expect(priceBasis(pageWith(), true)).toBe("Round-trip total for 2 adults, incl. taxes and fees");
    expect(priceBasis("Prices include required taxes + fees for 1 adult.", false)).toBe("One-way total for 1 adult, incl. taxes and fees");
    expect(priceBasis("nothing here", true)).toBeUndefined();
  });

  it("takes the trip type from the request, not the page's menus", () => {
    const menus = "Round trip\nOne way\nMulti-city\nPrices include required taxes + fees for 2 adults.";
    expect(priceBasis(menus, true)).toBe("Round-trip total for 2 adults, incl. taxes and fees");
  });
});

describe("rankAirports", () => {
  const airport = (code: string, miles: number, bestFare: number): AirportResult => ({
    code,
    name: AIRPORTS[code].name,
    miles,
    ground: rideshareRoundTrip(miles),
    bestFare,
    options: 3,
    searchUrl: `https://g/${code}`,
    status: "ok",
  });

  it("keeps the closest airport unless another saves at least $30 overall", () => {
    const r = rankAirports([airport("SJC", 6, 660), airport("SFO", 25, 543)]);
    expect(r.find((a) => a.code === "SJC")).toMatchObject({ closest: true, recommended: true, total: 705 });
    expect(r.find((a) => a.code === "SFO")).toMatchObject({ cheapest: true, total: 678 });
  });

  it("recommends a farther airport when it is $30 or more cheaper after the ride", () => {
    const r = rankAirports([airport("SJC", 6, 700), airport("SFO", 25, 543)]);
    expect(r.find((a) => a.recommended)?.code).toBe("SFO");
  });

  it("ignores failed airports and ranks by fare when there is no home location", () => {
    const failed: AirportResult = { code: "OAK", name: "Oakland", options: 0, searchUrl: "https://g/OAK", status: "failed" };
    const r = rankAirports([{ ...airport("SJC", 6, 700), miles: undefined, ground: undefined }, { ...airport("SFO", 25, 543), miles: undefined, ground: undefined }, failed]);
    expect(r.find((a) => a.recommended)?.code).toBe("SFO");
    expect(r.find((a) => a.code === "OAK")).not.toHaveProperty("recommended");
  });
});

describe("flights across nearby airports", () => {
  const pages: Record<string, Array<() => ReturnType<typeof ok>>> = {
    SJC: [() => fail("navigation timeout"), () => ok(pageWith(option("8:00 am", "9:35 am", "Southwest", 600)))],
    SFO: [() => ok(pageWith(option("3:10 pm", "8:57 pm", "Frontier", 543), option("7:30 pm", "10:40 pm", "Southwest", 733)))],
    OAK: [() => ok("Access denied"), () => ok("Access denied")],
  };
  const calls: string[] = [];
  const browse = async (actions: Array<{ op: string; url?: string }>) => {
    const q = new URL(actions[0].url!).searchParams.get("q")!;
    const code = q.split(" ")[2];
    calls.push(code);
    return (pages[code].shift() ?? (() => fail("no more")))();
  };

  it("searches each airport once (retrying a failure once) and returns one ranked card", async () => {
    const tool = flightsTool({ locale: "en-US", currency: "USD", browse: browse as never, home: async () => SUNNYVALE });
    const r = await tool.execute("c", { from: "SJC, SFO, OAK", to: "LAS", date: "2026-11-25", returnDate: "2026-11-29", adults: 2 }, undefined, undefined, {} as never);
    expect(calls).toEqual(["SJC", "SJC", "SFO", "OAK", "OAK"]);
    const data = (r.details as { data: Record<string, any> }).data;
    expect(data.airports.map((a: AirportResult) => [a.code, a.status])).toEqual([
      ["SJC", "ok"],
      ["SFO", "ok"],
      ["OAK", "failed"],
    ]);
    expect(data.airports[0]).toMatchObject({ closest: true, recommended: true, bestFare: 600, ground: 45 });
    expect(data.options.map((o: { origin: string; price: number }) => [o.origin, o.price])).toEqual([
      ["SFO", 543],
      ["SJC", 600],
      ["SFO", 733],
    ]);
    expect(data.priceNote).toBe("Round-trip total for 2 adults, incl. taxes and fees");
    expect(data.searchUrl).toBe(data.airports[0].searchUrl);
    const text = (r.content[0] as { text: string }).text;
    expect(text).toContain("SJC");
    expect(text).toContain("recommended");
    expect(text).toContain("OAK: couldn't load");
    const widget = renderData(data);
    expect(validateWidget(widget)).toMatchObject({ ok: true });
    expect(widget).toMatchObject({ airports: [{ code: "SJC", recommended: true }, { code: "SFO" }, { code: "OAK", status: "failed" }] });
  });
});

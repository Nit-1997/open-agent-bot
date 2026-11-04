import { describe, expect, it } from "vitest";
import { validateWidget } from "@oab/shared/widgets";
import { renderData } from "../../src/render/registry.js";
import { flightsTool, priceBasis } from "../../src/tools/flights.js";
import { AIRPORTS, driveRoute, milesBetween, nearbyAirports } from "../../src/tools/geo.js";
import { fakeFetch, json } from "../fixtures/fakeFetch.js";
import { fail, ok } from "../../src/tools/result.js";

const SUNNYVALE = { lat: 37.3688, lon: -122.0363 };

const option = (depart: string, arrive: string, airline: string, price: number) =>
  `${depart} – ${arrive}\n${airline}\n\n3 hrs 5 min\n\n1 stop\n\n$${price}\n`;
const pageWith = (...opts: string[]) =>
  `Round trip\n${opts.join("\n")}\nPrices include required taxes + fees for 2 adults. Optional charges may apply.\n`;

describe("geo", () => {
  it("knows the Bay Area airports and their distance from Sunnyvale", () => {
    expect(Math.round(milesBetween(SUNNYVALE, AIRPORTS.SJC))).toBeLessThan(10);
    expect(Math.round(milesBetween(SUNNYVALE, AIRPORTS.SFO))).toBeGreaterThan(20);
    expect(milesBetween(SUNNYVALE, AIRPORTS.OAK)).toBeGreaterThan(milesBetween(SUNNYVALE, AIRPORTS.SJC));
  });

  it("finds airports within 100 km of a home, closest first", () => {
    const paloAlto = { lat: 37.4419, lon: -122.143 };
    const near = nearbyAirports(paloAlto);
    expect(near.slice(0, 3)).toEqual(["SJC", "SFO", "OAK"]);
    expect(near).not.toContain("SMF");
    expect(nearbyAirports(paloAlto, 10)).toEqual([]);
  });

  it("covers London, Paris, and the big Indian metros", () => {
    expect(nearbyAirports({ lat: 51.5074, lon: -0.1278 })).toEqual(expect.arrayContaining(["LHR", "LCY", "LGW"]));
    expect(nearbyAirports({ lat: 48.8566, lon: 2.3522 })).toEqual(expect.arrayContaining(["CDG", "ORY"]));
    expect(nearbyAirports({ lat: 12.9716, lon: 77.5946 })).toEqual(["BLR"]);
    expect(nearbyAirports({ lat: 19.076, lon: 72.8777 })).toEqual(["BOM"]);
    expect(nearbyAirports({ lat: 28.6139, lon: 77.209 })).toEqual(["DEL"]);
  });

  it("gets real driving distance and time from OSRM", async () => {
    const f = fakeFetch([
      [
        /router\.project-osrm\.org\/route\/v1\/driving\/-122\.0363,37\.3688;-121\.9289,37\.3639/,
        () => json({ routes: [{ distance: 12070, duration: 840 }] }),
      ],
    ]);
    expect(await driveRoute(SUNNYVALE, AIRPORTS.SJC, f)).toEqual({ miles: 7.5, minutes: 14, source: "road" });
  });

  it("falls back to straight-line distance when routing fails", async () => {
    const f = fakeFetch([]);
    const r = await driveRoute(SUNNYVALE, AIRPORTS.SJC, f);
    expect(r).toMatchObject({ source: "estimate" });
    expect(r!.minutes).toBeUndefined();
    expect(r!.miles).toBeGreaterThan(6);
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

  it("searches each airport once, in parallel (retrying a failure once), and returns one card with rides and preferences", async () => {
    const drives: Record<string, { miles: number; minutes: number }> = {
      SJC: { miles: 7.5, minutes: 14 },
      SFO: { miles: 33, minutes: 38 },
    };
    const tool = flightsTool({
      locale: "en-US",
      currency: "USD",
      browse: browse as never,
      drive: async (code) => (drives[code] ? { ...drives[code], source: "road" as const } : null),
    });
    const r = await tool.execute(
      "c",
      {
        from: "SJC, SFO, OAK",
        to: "LAS",
        date: "2026-11-25",
        returnDate: "2026-11-29",
        adults: 2,
        max_layover: "5h",
        depart_times: "midday, evening",
      },
      undefined,
      undefined,
      {} as never,
    );
    expect([...calls].sort()).toEqual(["OAK", "OAK", "SFO", "SJC", "SJC"]);
    const data = (r.details as { data: Record<string, any> }).data;
    expect(data.airports).toEqual([
      { code: "SJC", name: "San Jose", miles: 7.5, driveMinutes: 14, rideOneWay: 26, status: "ok", searchUrl: expect.any(String) },
      { code: "SFO", name: "San Francisco", miles: 33, driveMinutes: 38, rideOneWay: 85, status: "ok", searchUrl: expect.any(String) },
      { code: "OAK", name: "Oakland", status: "failed", searchUrl: expect.any(String) },
    ]);
    expect(data.prefs).toEqual({ maxLayover: "5h", times: ["midday", "evening"] });
    expect(data.options.map((o: { origin: string; price: number }) => [o.origin, o.price])).toEqual([
      ["SFO", 543],
      ["SJC", 600],
      ["SFO", 733],
    ]);
    expect(data.priceNote).toBe("Round-trip total for 2 adults, incl. taxes and fees");
    const text = (r.content[0] as { text: string }).text;
    expect(text).toContain(
      "SFO San Francisco: 38 min drive, ride about 85 USD each way (estimate), best matching fare 543 USD, about 713 USD all-in (best value)",
    );
    expect(text).toContain("SJC San Jose: 14 min drive");
    expect(text).toContain("no flights match the preferences");
    expect(text).toContain("OAK: couldn't load");
    expect(text).toContain(
      "Matching the preferences (layovers up to 5h; departs midday 9 am–4 pm or evening 4–10 pm):\n- SFO: Frontier 3:10 pm",
    );
    expect(text).toContain("Other options (outside the preferences):\n- SJC: Southwest 8:00 am");
    const widget = renderData(data);
    expect(validateWidget(widget)).toMatchObject({ ok: true });
    expect(widget).toMatchObject({
      prefs: { maxLayover: "5h" },
      airports: [{ code: "SJC", rideOneWay: 26 }, { code: "SFO" }, { code: "OAK", status: "failed" }],
    });
  });
});

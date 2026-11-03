import { describe, expect, it } from "vitest";
import { departBucket, matchesPrefs, rankAirports, rideOneWay } from "@oab/shared/flights";

describe("departBucket", () => {
  it("buckets 12h and 24h times into parts of the day", () => {
    expect(departBucket("6:00 AM")).toBe("early_morning");
    expect(departBucket("8:59 am")).toBe("early_morning");
    expect(departBucket("12:30 PM")).toBe("midday");
    expect(departBucket("3:10 pm")).toBe("midday");
    expect(departBucket("4:15 PM")).toBe("evening");
    expect(departBucket("9:11 PM")).toBe("evening");
    expect(departBucket("22:05")).toBe("late_night");
    expect(departBucket("12:10 am")).toBe("late_night");
    expect(departBucket("soon")).toBeNull();
  });
});

describe("matchesPrefs", () => {
  const nonstop = { departTime: "8:00 AM", stops: 0 };
  const shortHop = { departTime: "3:10 PM", stops: 1, layoverMinutes: 95 };
  const longHop = { departTime: "3:10 PM", stops: 1, layoverMinutes: 7 * 60 };
  const unknownHop = { departTime: "9:00 PM", stops: 2 };

  it("filters by the longest layover the user accepts", () => {
    expect([nonstop, shortHop, longHop].filter((f) => matchesPrefs(f, { maxLayover: "nonstop" }))).toEqual([nonstop]);
    expect([nonstop, shortHop, longHop].filter((f) => matchesPrefs(f, { maxLayover: "5h" }))).toEqual([nonstop, shortHop]);
    expect([nonstop, shortHop, longHop].filter((f) => matchesPrefs(f, { maxLayover: "10h" }))).toEqual([nonstop, shortHop, longHop]);
  });

  it("keeps flights whose layover length is unknown unless nonstop is required", () => {
    expect(matchesPrefs(unknownHop, { maxLayover: "5h" })).toBe(true);
    expect(matchesPrefs(unknownHop, { maxLayover: "nonstop" })).toBe(false);
  });

  it("filters by departure times, any of the chosen ones", () => {
    expect(matchesPrefs(nonstop, { times: ["early_morning", "evening"] })).toBe(true);
    expect(matchesPrefs(shortHop, { times: ["early_morning", "evening"] })).toBe(false);
    expect(matchesPrefs(shortHop, {})).toBe(true);
  });
});

describe("rideOneWay", () => {
  it("is calibrated to typical Bay Area fares", () => {
    expect(rideOneWay(7.5)).toBe(26);
    expect(rideOneWay(33)).toBe(85);
  });
});

describe("rankAirports", () => {
  const airports = [
    { code: "SJC", status: "ok" as const, rideOneWay: 26, driveMinutes: 14 },
    { code: "SFO", status: "ok" as const, rideOneWay: 85, driveMinutes: 38 },
    { code: "OAK", status: "failed" as const, rideOneWay: 90, driveMinutes: 40 },
  ];
  const flights = [
    { origin: "SFO", price: 543, departTime: "3:10 PM", stops: 1, layoverMinutes: 400 },
    { origin: "SFO", price: 596, departTime: "10:30 PM", stops: 0 },
    { origin: "SJC", price: 623, departTime: "4:15 PM", stops: 0 },
  ];

  it("ranks purely by fare plus a round-trip ride, best value first, failed last", () => {
    const r = rankAirports(airports, flights, {});
    expect(r.map((a) => [a.code, a.bestFare, a.total, a.bestValue ?? false, a.closest ?? false])).toEqual([
      ["SJC", 623, 675, true, true],
      ["SFO", 543, 713, false, false],
      ["OAK", undefined, undefined, false, false],
    ]);
  });

  it("uses only flights matching the preferences", () => {
    const r = rankAirports(airports, flights, { maxLayover: "5h", times: ["late_night"] });
    expect(r.find((a) => a.code === "SFO")).toMatchObject({ bestFare: 596, total: 766 });
    expect(r.find((a) => a.code === "SJC")).toMatchObject({ noMatch: true });
    expect(r.find((a) => a.code === "SJC")).not.toHaveProperty("bestFare");
    expect(r[0].code).toBe("SFO");
  });

  it("ranks by fare alone when rides are unknown", () => {
    const r = rankAirports(
      airports.map(({ rideOneWay: _r, driveMinutes: _d, ...a }) => a),
      flights,
      {},
    );
    expect(r[0]).toMatchObject({ code: "SFO", total: 543, bestValue: true });
  });
});

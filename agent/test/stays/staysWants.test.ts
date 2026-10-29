import { describe, expect, it, vi } from "vitest";
import { validateWidget } from "../../../shared/widgets.js";
import { type Judge, noJudge, type YesNoCriteria } from "../../src/judge/index.js";
import { stayMatch } from "../../src/judge/criteria/stayMatch.js";
import { renderData } from "../../src/render/registry.js";
import type { OpenTab } from "../../src/stays/search.js";
import type { StaySource } from "../../src/stays/types.js";
import { parseBudget, staysTool } from "../../src/tools/stays.js";

type Listing = { title: string; nightly?: number; currency?: string; kind?: string; area?: string };

function fakeTab(): { openTab: OpenTab; opened: string[] } {
  const opened: string[] = [];
  const openTab: OpenTab = async () => {
    let url = "about:blank";
    const page = {
      goto: async (u: string) => {
        url = u;
        opened.push(u);
        return { status: () => 200 };
      },
      url: () => url,
      waitForLoadState: async () => {},
      waitForTimeout: async () => {},
      mouse: { wheel: async () => {} },
      evaluate: async () => "",
    };
    return { page: page as never, close: async () => {} };
  };
  return { openTab, opened };
}

const paris = (rows: Listing[]): StaySource => ({
  id: "paris",
  label: "PARIS",
  site: "paris.test",
  lists: ["hotel"],
  searchUrl: (q) => `https://paris.test/s?curr=${q.currency}`,
  read: async () => rows.map((r, i) => ({ ...r, url: `https://paris.test/${i}`, ...(r.nightly != null && { total: r.nightly * 3 }) })),
});

type Extra = Partial<Parameters<typeof staysTool>[0]>;

function parisTool(rows: Listing[], extra: Extra = {}, currency = "USD") {
  const tab = fakeTab();
  const tool = staysTool({ openTab: tab.openTab, currency, sources: [paris(rows)], ...extra });
  const run = async (params: Record<string, unknown>) => {
    const r = await tool.execute("c", { location: "Paris", checkin: "2026-12-10", checkout: "2026-12-13", ...params } as never, undefined, undefined, {} as never);
    const text = (r.content[0] as { text: string }).text;
    const data = (r.details as { data: { currency: string; maxNightly?: number; sources: Array<{ stays: Array<{ title: string; met?: string[]; currency?: string }> }> } }).data;
    return { r, text, data, titles: data.sources[0].stays.map((s) => s.title) };
  };
  return { tool, run, tab };
}

const rateOf = (table: Record<string, number>) => async (from: string, to: string) => (from === to ? 1 : (table[`${from}${to}`] ?? null));

describe("stays max_price currency", () => {
  const rows: Listing[] = [{ title: "Cheap", nightly: 350 }, { title: "Edge", nightly: 400 }, { title: "Dear", nightly: 450 }, { title: "Unpriced" }];

  it("filters a plain number in the user's currency like before", async () => {
    const { titles, text, data } = await parisTool(rows).run({ max_price: 400 });
    expect(titles).toEqual(["Cheap", "Edge", "Unpriced"]);
    expect(text).toContain("up to $400.00/night");
    expect(data.currency).toBe("USD");
  });

  it("searches in the asked currency and shows the budget in it, not in the user's currency", async () => {
    const { run, tab } = parisTool(rows);
    const { titles, text, data } = await run({ max_price: { amount: 400, currency: "EUR" } });
    expect(tab.opened[0]).toBe("https://paris.test/s?curr=EUR");
    expect(titles).toEqual(["Cheap", "Edge", "Unpriced"]);
    expect(data.currency).toBe("EUR");
    expect(data.maxNightly).toBe(400);
    expect(text).toContain("up to €400.00/night");
    expect(text).toContain("Cheap — €350.00/night");
    expect(text).not.toContain("$");
  });

  it("converts listings that came back in another currency before comparing", async () => {
    const mixed: Listing[] = [{ title: "Dollar fair", nightly: 420, currency: "USD" }, { title: "Dollar dear", nightly: 480, currency: "USD" }, { title: "Euro fair", nightly: 390 }];
    const { titles, text, data } = await parisTool(mixed, { fx: rateOf({ USDEUR: 0.9 }) }).run({ max_price: { amount: 400, currency: "EUR" } });
    expect(titles).toEqual(["Dollar fair", "Euro fair"]);
    expect(text).toContain("Dollar fair — $420.00/night");
    expect(text).toContain("Euro fair — €390.00/night");
    expect(data.sources[0].stays[0].currency).toBe("USD");
  });

  it("converts listings in euros against a budget in the user's own currency", async () => {
    const euro: Listing[] = [{ title: "Fits", nightly: 400, currency: "EUR" }, { title: "Too much", nightly: 420, currency: "EUR" }];
    const { titles } = await parisTool(euro, { fx: rateOf({ EURUSD: 1.1 }) }).run({ max_price: 450 });
    expect(titles).toEqual(["Fits"]);
  });

  it("skips the price filter and says so when no rate can be fetched", async () => {
    const mixed: Listing[] = [{ title: "Dollar dear", nightly: 900, currency: "USD" }, { title: "Euro fair", nightly: 390 }];
    const { titles, text, data } = await parisTool(mixed, { fx: async () => null }).run({ max_price: { amount: 400, currency: "EUR" } });
    expect(titles).toEqual(["Dollar dear", "Euro fair"]);
    expect(text).toContain("exchange rate could not be fetched, so the budget was not applied");
    expect(data.maxNightly).toBeUndefined();
  });

  it("makes no rate request when every price is already in the budget currency", async () => {
    let asked = 0;
    const counting = async () => {
      asked++;
      return 1;
    };
    await parisTool(rows, { fx: counting }).run({ max_price: { amount: 400, currency: "EUR" } });
    expect(asked).toBe(0);
  });

  it("accepts a currency symbol or lowercase code and ignores a zero amount", async () => {
    const { run } = parisTool(rows);
    expect((await run({ max_price: { amount: 400, currency: "€" } })).data.currency).toBe("EUR");
    expect((await run({ max_price: { amount: 400, currency: "gbp" } })).data.currency).toBe("GBP");
    expect((await run({ max_price: { amount: 0, currency: "EUR" } })).titles).toHaveLength(4);
  });
});

describe("parseBudget", () => {
  it("reads numbers, objects and numeric strings", () => {
    expect(parseBudget(400, "USD")).toEqual({ amount: 400, currency: "USD", explicit: false });
    expect(parseBudget({ amount: 400, currency: "eur" }, "USD")).toEqual({ amount: 400, currency: "EUR", explicit: true });
    expect(parseBudget("250", "GBP")).toEqual({ amount: 250, currency: "GBP", explicit: false });
    expect(parseBudget({ amount: 400, currency: "euros" }, "USD")?.explicit).toBe(false);
    expect(parseBudget(undefined, "USD")).toBeUndefined();
    expect(parseBudget(-5, "USD")).toBeUndefined();
  });
});

describe("stays wants", () => {
  const rows: Listing[] = [
    { title: "Hotel Indie", nightly: 150, area: "Marais" },
    { title: "Courtyard by Marriott Paris Gare de Lyon", nightly: 320, area: "12th" },
    { title: "Hyatt Regency Paris Etoile", nightly: 380, area: "17th" },
    { title: "Hotel du Louvre, Paris, a Hyatt hotel", nightly: 390, area: "1st, near Louvre" },
  ];

  function judgeFor(log: string[] = []): Judge {
    const verdict = (c: YesNoCriteria, title: string) => {
      if (c === stayMatch.brand) return /Marriott|Hyatt/.test(title);
      if (c === stayMatch.area) return /Louvre/.test(title);
      return false;
    };
    return {
      available: true,
      score: async () => null,
      choose: async () => null,
      usage: () => ({ calls: 0, failures: 0, costUsd: 0 }),
      yesno: async (items, c, o) => {
        log.push(`${c.id}:${items.length}:${JSON.stringify(o?.batch?.shared)}`);
        return items.map((it) => ({ id: it.id, yes: verdict(c, String(it.state.title)), p: 0.9 }));
      },
    };
  }

  it("is not in the schema, and changes nothing, without a judge", () => {
    const { tool } = parisTool(rows);
    expect(Object.keys((tool.parameters as { properties: object }).properties)).not.toContain("wants");
    expect(tool.description).not.toContain("Pass wants");
  });

  it("explains wants and currency budgets in the description when enabled", () => {
    const { tool } = parisTool(rows, { judge: judgeFor() });
    expect(Object.keys((tool.parameters as { properties: object }).properties)).toContain("wants");
    expect(tool.description).toContain("Pass wants with brand");
    expect(tool.description).toContain('{ amount: 400, currency: "EUR" }');
  });

  it("ranks listings meeting all wishes first, then by wishes met, then by price, and shows what each meets", async () => {
    const log: string[] = [];
    const { titles, text, data } = await parisTool(rows, { judge: judgeFor(log) }, "EUR").run({ wants: { brand: ["Marriott", "Hyatt"], area: "the Louvre" } });
    expect(titles).toEqual(["Hotel du Louvre, Paris, a Hyatt hotel", "Courtyard by Marriott Paris Gare de Lyon", "Hyatt Regency Paris Etoile", "Hotel Indie"]);
    expect(data.sources[0].stays.map((s) => s.met)).toEqual([["Marriott/Hyatt", "near the Louvre"], ["Marriott/Hyatt"], ["Marriott/Hyatt"], []]);
    expect(text).toContain("matches: ✓ Marriott/Hyatt · ✓ near the Louvre");
    expect(log).toHaveLength(2);
    expect(log[0]).toContain('"brands":["Marriott","Hyatt"]');
    expect(log[1]).toContain('"area":"the Louvre","location":"Paris"');
  });

  it("accepts brand as a plain string and a vibe wish", async () => {
    const log: string[] = [];
    const { data } = await parisTool(rows, { judge: judgeFor(log) }).run({ wants: { brand: "Hyatt", vibe: "quiet boutique" } });
    expect(log.map((l) => l.split(":")[0])).toEqual(["stayBrand", "stayVibe"]);
    expect(data.sources[0].stays.every((s) => Array.isArray(s.met))).toBe(true);
  });

  it("says plainly when no listing meets the brand under budget", async () => {
    const few: Listing[] = [{ title: "Hotel Indie", nightly: 150 }, { title: "Hyatt Regency Paris Etoile", nightly: 650 }];
    const { text } = await parisTool(few, { judge: judgeFor() }, "EUR").run({ max_price: { amount: 400, currency: "EUR" }, wants: { brand: ["Marriott", "Hyatt"] } });
    expect(text).toContain("No Marriott or Hyatt under €400.00/night in these results.");
  });

  it("does not say that when a listing meets the brand", async () => {
    const { text } = await parisTool(rows, { judge: judgeFor() }, "EUR").run({ wants: { brand: ["Hyatt"] } });
    expect(text).not.toContain("No Hyatt");
  });

  it("keeps price order, hides wishes, and says so when the judge is unavailable", async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((l: string) => void logs.push(l));
    try {
      const { titles, text, data } = await parisTool(rows, { judge: noJudge }, "EUR").run({ wants: { brand: ["Hyatt"] } });
      expect(titles).toEqual(["Hotel Indie", "Courtyard by Marriott Paris Gare de Lyon", "Hyatt Regency Paris Etoile", "Hotel du Louvre, Paris, a Hyatt hotel"]);
      expect(data.sources[0].stays.every((s) => s.met === undefined)).toBe(true);
      expect(text).not.toContain("matches:");
      expect(text).toContain("could not be checked automatically");
      expect(logs.some((l) => l.includes("[stays] wants fallback"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("renders met wishes into a valid stay_list widget", async () => {
    const { r } = await parisTool(rows, { judge: judgeFor() }, "EUR").run({ wants: { brand: ["Hyatt"] } });
    const widget = renderData((r.details as { data: unknown }).data);
    expect(validateWidget(widget).ok).toBe(true);
    expect(JSON.stringify(widget)).toContain('"met":["Hyatt"]');
  });
});

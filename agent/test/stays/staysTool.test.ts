import { describe, expect, it } from "vitest";
import { validateWidget } from "@oab/shared/widgets";
import { renderData } from "../../src/render/registry.js";
import type { OpenTab } from "../../src/stays/types.js";
import { staySource } from "../../src/sources/stays/define.js";
import type { StaySource } from "../../src/stays/types.js";
import { pickSources, staysTool } from "../../src/tools/stays.js";

function fakeTab(pages: Record<string, string>): { openTab: OpenTab; opened: string[]; live: boolean[] } {
  const opened: string[] = [];
  const live: boolean[] = [];
  const openTab: OpenTab = async (isLive) => {
    live.push(isLive);
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
      evaluate: async () => pages[new URL(url).host] ?? "",
    };
    return { page: page as never, close: async () => {} };
  };
  return { openTab, opened, live };
}

const source = (id: string, lists: StaySource["lists"], titles: string[], read = true): StaySource =>
  staySource({
    id,
    label: id.toUpperCase(),
    site: `${id}.test`,
    lists,
    searchUrl: (q) => `https://${id}.test/search?where=${encodeURIComponent(q.location)}`,
    ...(read && {
      read: async () => titles.map((t, i) => ({ title: t, url: `https://${id}.test/${i}`, nightly: 100 * (i + 1), total: 300 * (i + 1) })),
    }),
  });

const sources = [
  source("hotels", ["hotel"], ["Grand", "Plaza"]),
  source("homes", ["rental"], ["Loft"]),
  source("walled", ["hotel", "rental"], ["x"]),
  source("linkonly", ["hotel"], [], false),
];

const run = (
  params: Record<string, unknown>,
  pages: Record<string, string> = { "walled.test": "Are you a robot?" },
  preferred?: Parameters<typeof staysTool>[0]["preferred"],
) => {
  const tab = fakeTab(pages);
  const tool = staysTool({ openTab: tab.openTab, currency: "USD", sources, preferred });
  return {
    tab,
    result: tool.execute(
      "c",
      { location: "Las Vegas", checkin: "2026-11-12", checkout: "2026-11-15", ...params } as never,
      undefined,
      undefined,
      {} as never,
    ),
  };
};

describe("stays tool", () => {
  it("searches every readable source at once, reports blocked and link-only sources, and renders a valid card", async () => {
    const { tab, result } = run({});
    const r = await result;
    const text = (r.content[0] as { text: string }).text;
    expect(text).toContain("Stays in Las Vegas, 2026-11-12 to 2026-11-15 (3 nights), 2 adults.");
    expect(text).toContain("- Grand — $100.00/night ($300.00 total)");
    expect(text).toContain("WALLED: blocked by a bot check. Link for the user: https://walled.test/search?where=Las%20Vegas");
    expect(text).toContain("LINKONLY: not searched automatically. Link for the user:");
    expect(tab.opened).toHaveLength(3);
    expect(tab.live.filter(Boolean)).toHaveLength(1);
    const data = (r.details as { data: unknown }).data;
    const widget = renderData(data);
    expect(widget?.kind).toBe("stay_list");
    expect(validateWidget(widget).ok).toBe(true);
  });

  it("drops listings above the nightly budget but keeps unpriced ones", async () => {
    const r = await run({ max_price: 150 }).result;
    const data = (r.details as { data: { sources: Array<{ id: string; stays: Array<{ title: string }> }> } }).data;
    expect(data.sources.find((s) => s.id === "hotels")?.stays.map((s) => s.title)).toEqual(["Grand"]);
  });

  it("defaults to the user's stay type and sites, unless the request names others", async () => {
    const preferred = () => ({ type: "rental" as const, sources: ["homes"], brands: [] });
    const mine = run({}, {}, preferred);
    const asked = run({ type: "hotel", sources: ["hotels"] }, {}, preferred);
    const wrongType = run({ type: "hotel" }, {}, preferred);
    await Promise.all([mine.result, asked.result, wrongType.result]);
    expect(mine.tab.opened.map((u) => new URL(u).host)).toEqual(["homes.test"]);
    expect(asked.tab.opened.map((u) => new URL(u).host)).toEqual(["hotels.test"]);
    expect(wrongType.tab.opened.map((u) => new URL(u).host).sort()).toEqual(["hotels.test", "walled.test"]);
  });

  it("validates dates", async () => {
    expect((await run({ checkout: "2026-11-12" }).result).isError).toBe(true);
    expect((await run({ checkin: "Nov 12" }).result).isError).toBe(true);
    expect((await run({ checkout: "2027-01-30" }).result).isError).toBe(true);
  });
});

describe("pickSources", () => {
  it("filters by listing type and by the sites the user named", () => {
    expect(pickSources(sources, [], "rental").map((s) => s.id)).toEqual(["homes", "walled"]);
    expect(pickSources(sources, ["Homes"], "any").map((s) => s.id)).toEqual(["homes"]);
    expect(pickSources(sources, ["unknown"], "any")).toHaveLength(4);
  });
});

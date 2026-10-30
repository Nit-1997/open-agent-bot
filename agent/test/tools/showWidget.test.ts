import { describe, expect, it } from "vitest";
import { validateWidget } from "../../../shared/widgets.js";
import { showUiTool } from "../../src/tools/showWidget.js";
import { validWidgets } from "../fixtures/widgets.js";

const exec = (params: unknown) =>
  showUiTool().execute(...(["c", params, undefined, undefined, {}] as never[])) as Promise<{
    isError?: boolean;
    content: Array<{ text: string }>;
    details: { widget?: unknown };
  }>;

const { kind: _k, ...uiParams } = validWidgets.ui;

describe("validateWidget", () => {
  for (const [kind, w] of Object.entries(validWidgets)) {
    it(`accepts valid ${kind}`, () => {
      expect(validateWidget(w)).toMatchObject({ ok: true, value: { kind } });
    });
  }

  it("rejects unknown kind", () => {
    const r = validateWidget({ kind: "map" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/kind/);
  });

  it("reports block errors with their path", () => {
    const r = validateWidget({ ...validWidgets.ui, blocks: [{ type: "carousel" }, { type: "links", items: [{ label: "x" }] }] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]).toMatch(/^\/blocks\/0\/type: must be one of heading, text/);
      expect(r.errors.join("\n")).toContain("/blocks/1/items/0");
    }
  });
});

describe("card length limits", () => {
  it("rejects a callout that runs past one sentence's worth, with the path", () => {
    const r = validateWidget({ ...validWidgets.ui, blocks: [{ type: "callout", tone: "info", text: "x".repeat(161) }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toMatch(/\/blocks\/0\/text: .*160/);
  });

  it("caps how many blocks and list items a card can hold", () => {
    const tooManyBlocks = validateWidget({ ...validWidgets.ui, blocks: Array.from({ length: 9 }, () => ({ type: "text", text: "hi" })) });
    expect(tooManyBlocks.ok).toBe(false);
    const items = Array.from({ length: 11 }, (_, i) => ({ title: `Item ${i}` }));
    const tooManyItems = validateWidget({ ...validWidgets.ui, blocks: [{ type: "list", items }] });
    expect(tooManyItems.ok).toBe(false);
    if (!tooManyItems.ok) expect(tooManyItems.errors[0]).toContain("/blocks/0/items");
  });

  it("accepts picture cards in square and wide shapes, capped at 10", () => {
    const item = {
      title: "Mercurial Vapor 17 Academy TF",
      price: "$100",
      image: "https://static.nike.com/a/vapor.png",
      url: "https://www.nike.com/t/vapor",
      source: "Nike",
    };
    const hotel = {
      title: "Memmo Alfama",
      subtitle: "Boutique hotel",
      rating: "4.7",
      price: "$310/night",
      place: "Memmo Alfama, Lisbon",
      image: "https://img.com/m.jpg",
    };
    expect(validateWidget({ ...validWidgets.ui, blocks: [{ type: "cards", items: [item] }] }).ok).toBe(true);
    expect(validateWidget({ ...validWidgets.ui, blocks: [{ type: "cards", shape: "wide", items: [hotel] }] }).ok).toBe(true);
    expect(validateWidget({ ...validWidgets.ui, blocks: [{ type: "cards", shape: "round", items: [item] }] }).ok).toBe(false);
    expect(validateWidget({ ...validWidgets.ui, blocks: [{ type: "cards", items: Array.from({ length: 11 }, () => item) }] }).ok).toBe(
      false,
    );
  });

  it("accepts a single image with a caption", () => {
    expect(
      validateWidget({
        ...validWidgets.ui,
        blocks: [{ type: "image", url: "https://upload.wikimedia.org/x.jpg", caption: "Belém Tower", source: "Wikipedia" }],
      }).ok,
    ).toBe(true);
  });

  it("keeps titles short", () => {
    expect(validateWidget({ ...validWidgets.ui, title: "t".repeat(61) }).ok).toBe(false);
  });
});

describe("show_ui", () => {
  it("describes picture cards and images to the model in the blocks parameter", () => {
    const d = (showUiTool().parameters as { properties: { blocks: { description: string } } }).properties.blocks.description;
    expect(d).toContain(
      '{type:"cards", shape?:"square"|"wide", items:[{title, subtitle?, image?, url?, price?, rating?, source?, place?, note?, badge?}]}',
    );
    expect(d).toContain('{type:"image", url, caption?, source?}');
  });

  it("takes title and blocks and returns a valid ui widget", async () => {
    const res = await exec(uiParams);
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toMatch(/^Card shown\. Now reply in at most two short sentences/);
    expect(res.details.widget).toEqual(validWidgets.ui);
  });

  it("accepts numbers where text is expected", async () => {
    const blocks = [
      { type: "stats", items: [{ label: "Guests", value: 25 }] },
      { type: "table", columns: ["Item", "Price"], rows: [["Diya", 6.99]] },
    ];
    const res = await exec({ title: "x", blocks });
    expect(res.isError).toBeFalsy();
    expect(res.details.widget).toMatchObject({
      blocks: [{ items: [{ value: "25" }] }, { rows: [["Diya", "6.99"]] }],
    });
  });

  it("accepts blocks sent as a JSON string", async () => {
    const res = await exec({ title: "x", blocks: JSON.stringify([{ type: "text", text: "hi" }]) });
    expect(res.isError).toBeFalsy();
    expect(res.details.widget).toMatchObject({ blocks: [{ type: "text", text: "hi" }] });
  });

  it("explains a blocks string that isn't valid JSON", async () => {
    const res = await exec({ title: "x", blocks: "[{type: text}" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/blocks must be an array/);
  });

  it("its parameter schema lets pi pass a blocks string through", () => {
    const blocks = (showUiTool().parameters as { properties: { blocks: { anyOf?: Array<{ type: string }> } } }).properties.blocks;
    expect(blocks.anyOf?.map((s) => s.type)).toEqual(["array", "string"]);
  });

  it("returns path-level errors the model can fix", async () => {
    const res = await exec({ title: "x", blocks: [{ type: "callout", tone: "loud", text: "hi" }] });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/^invalid card:/);
    expect(res.content[0].text).toContain("/blocks/0/tone");
    expect(res.details.widget).toBeUndefined();
  });
});

describe("flight schema", () => {
  it("requires duration as text, not minutes", () => {
    const f = validWidgets.flight_list;
    const { duration: _d, ...flight } = f.flights[0];
    const r = validateWidget({ ...f, flights: [{ ...flight, durationMin: 1200 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("\n")).toContain("/flights/0");
  });
});

describe("show_ui image fill", () => {
  const execWith = (findImage: (name: string, source?: string) => Promise<string | undefined>, params: unknown) =>
    showUiTool({ findImage }).execute(...(["c", params, undefined, undefined, {}] as never[])) as Promise<{
      content: Array<{ text: string }>;
      details: { widget: { blocks: Array<{ items: Array<{ title: string; image?: string }> }> }; sourced?: string };
    }>;

  it("looks up a picture for every card that has none, by name and source", async () => {
    const asked: string[] = [];
    const findImage = async (name: string, source?: string) => {
      asked.push([name, source].filter(Boolean).join(" "));
      return name.startsWith("Barilla") ? "https://tse1.mm.bing.net/barilla.jpg" : undefined;
    };
    const res = await execWith(findImage, {
      title: "Mac and cheese cart",
      blocks: [
        {
          type: "cards",
          items: [
            { title: "Barilla Elbow Macaroni 16 oz", source: "Shipt" },
            { title: "Good & Gather Sharp Cheddar", image: "https://target.scene7.com/cheddar.jpg" },
            { title: "First Street Butter" },
          ],
        },
      ],
    });
    expect(asked).toEqual(["Barilla Elbow Macaroni 16 oz Shipt", "First Street Butter"]);
    const items = res.details.widget.blocks[0].items;
    expect(items.map((i) => i.image)).toEqual(["https://tse1.mm.bing.net/barilla.jpg", "https://target.scene7.com/cheddar.jpg", undefined]);
    expect(res.details.sourced).toContain("https://tse1.mm.bing.net/barilla.jpg");
  });
});

describe("show_ui replaces unsourced pictures", () => {
  it("looks up a picture when the card's image wasn't returned by any tool", async () => {
    const tool = showUiTool({
      findImage: async () => "https://tse1.mm.bing.net/real.jpg",
      isSourced: (u) => u.includes("target.scene7.com"),
    });
    const res = (await tool.execute(
      ...([
        "c",
        {
          title: "Cart",
          blocks: [
            {
              type: "cards",
              items: [
                { title: "Made-up picture", image: "https://cdn.invented.example/x.jpg" },
                { title: "Sourced picture", image: "https://target.scene7.com/ok.jpg" },
              ],
            },
          ],
        },
        undefined,
        undefined,
        {},
      ] as never[]),
    )) as { details: { widget: { blocks: Array<{ items: Array<{ image?: string }> }> } } };
    expect(res.details.widget.blocks[0].items.map((i) => i.image)).toEqual([
      "https://tse1.mm.bing.net/real.jpg",
      "https://target.scene7.com/ok.jpg",
    ]);
  });
});

describe("show_ui fits text to the card instead of failing", () => {
  it("trims long labels and table cells and drops extra items", async () => {
    const r = await exec({
      title: "Jev for agent evals: where it helps",
      blocks: [
        { type: "stats", items: [{ label: "Cost per call (LangChain test)", value: "$0.00035" }] },
        { type: "table", columns: ["Use"], rows: [["A table cell that is much longer than forty-eight characters allows"]] },
        { type: "checklist", items: Array.from({ length: 15 }, (_, i) => ({ text: `step ${i}` })) },
      ],
    });
    expect(r.isError).toBeFalsy();
    const blocks = (r.details.widget as { blocks: Array<Record<string, any>> }).blocks;
    expect(blocks[0].items[0].label).toBe("Cost per call (LangChai…");
    expect(blocks[0].items[0].label).toHaveLength(24);
    expect(blocks[1].rows[0][0]).toHaveLength(48);
    expect(blocks[2].items).toHaveLength(12);
  });

  it("still rejects structural mistakes", async () => {
    const r = await exec({ title: "x", blocks: [{ type: "links", items: [{ label: "no url" }] }] });
    expect(r.isError).toBe(true);
  });
});

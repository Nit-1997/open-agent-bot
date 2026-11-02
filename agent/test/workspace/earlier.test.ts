import { describe, expect, it } from "vitest";
import type { MessagePart, StoredMessage } from "../../../shared/chats.js";
import { earlierCards, earlierNote } from "../../src/workspace/earlier.js";

const cart = (name: string, total: number, extra: object = {}) => ({
  kind: "cart",
  stores: [
    {
      name,
      total,
      currency: "USD",
      url: "https://example.com/",
      missing: [],
      items: [
        { query: "corn tortillas", qty: 2, picks: [] },
        { query: "black beans", qty: 4, picks: [] },
        { query: "avocados", qty: 1, picks: [] },
      ],
      ...extra,
    },
  ],
});

const trip = (id: string, destination: string) => ({
  kind: "plan",
  entity: "trip",
  id,
  version: 1,
  value: { destination, start: "2026-11-14", end: "2026-11-16", travelers: 2, budget: 900, stays: [{ name: "Inn" }], days: [] },
});

const event = (id: string) => ({ kind: "plan", entity: "event", id, version: 1, value: { title: "Party", guests: 12 } });

const widget = (id: string, w: unknown): MessagePart => ({ type: "tool", id, name: "show_widget", args: JSON.stringify({ widget: w }) });

const row = (createdAt: string, parts?: MessagePart[], status: StoredMessage["status"] = "complete"): StoredMessage => ({
  role: "assistant",
  content: "",
  status,
  createdAt,
  ...(parts && { parts }),
});

describe("earlierCards", () => {
  it("keeps the newest valid cart and the newest plan per entity and id, newest first, with each row's date", () => {
    const cards = earlierCards([
      row("2026-10-30T10:00:00Z", [widget("a", cart("Old Store", 30)), widget("p1", trip("big-sur", "Big Sur"))]),
      row("2026-10-31T10:00:00Z", [widget("b", cart("Trader Joe's", 18.4)), widget("p2", event("main"))]),
      row("2026-11-01T10:00:00Z", [widget("p3", trip("big-sur", "Big Sur North"))]),
    ]);
    expect(cards.cart).toMatchObject({ at: "2026-10-31T10:00:00Z", card: { stores: [{ name: "Trader Joe's" }] } });
    expect(cards.plans.map((p) => [p.card.entity, p.card.id, p.at])).toEqual([
      ["trip", "big-sur", "2026-11-01T10:00:00Z"],
      ["event", "main", "2026-10-31T10:00:00Z"],
    ]);
    expect((cards.plans[0].card.value as { destination: string }).destination).toBe("Big Sur North");
  });

  it("keeps at most three plans", () => {
    const cards = earlierCards([
      row(
        "2026-11-01T10:00:00Z",
        ["a", "b", "c", "d"].map((id) => widget(id, event(id))),
      ),
    ]);
    expect(cards.plans.map((p) => p.card.id)).toEqual(["d", "c", "b"]);
  });

  it("skips invalid or unparsable cards and rows without parts, and reads interrupted rows", () => {
    const cards = earlierCards([
      row("2026-10-30T10:00:00Z", [widget("a", cart("Kept", 10))], "interrupted"),
      row("2026-10-31T10:00:00Z", [
        widget("b", { kind: "cart", stores: [] }),
        { type: "tool", id: "c", name: "show_widget", args: "{bad" },
      ]),
      row("2026-11-01T10:00:00Z"),
      row("2026-11-01T11:00:00Z", [
        { type: "text", text: "hi" },
        { type: "tool", id: "d", name: "research", args: "{}" },
      ]),
      row("2026-11-01T12:00:00Z", [widget("e", { kind: "weather_card" })]),
    ]);
    expect(cards.cart?.card.stores[0].name).toBe("Kept");
    expect(cards.plans).toEqual([]);
  });
});

describe("earlierNote", () => {
  const cards = earlierCards([
    row("2026-11-01T15:10:00Z", [widget("a", cart("Trader Joe's", 18.4)), widget("p", trip("big-sur/weekend", "Big Sur"))]),
  ]);

  it("describes the cart and plans as read-only and dated", () => {
    const note = earlierNote(cards, { cartLive: false, plansLive: false })!;
    expect(note.startsWith("<earlier_cards>\nCards shown earlier in this chat. They are read-only")).toBe(true);
    expect(note).toContain("don't quote these totals as current.");
    expect(note).toContain(
      "cart (shown 2026-11-01): corn tortillas ×2, black beans ×4, avocados at Trader Joe's; best $18.40 at Trader Joe's",
    );
    expect(note).toContain(
      "trip big-sur/weekend (shown 2026-11-01): Big Sur, 2026-11-14 to 2026-11-16, 2 travelers, budget $900, 1 stays shortlisted",
    );
    expect(note.indexOf("cart (shown")).toBeLessThan(note.indexOf("trip big-sur"));
    expect(note.endsWith("\n</earlier_cards>")).toBe(true);
  });

  it("names the cheapest store with nothing missing, else the cheapest", () => {
    const two = (aMissing: string[]) => ({
      kind: "cart",
      stores: [
        { ...cart("Cheap", 10).stores[0], missing: aMissing },
        { ...cart("Full", 20).stores[0], currency: "EUR" },
      ],
    });
    const best = (missing: string[]) =>
      earlierNote(earlierCards([row("2026-11-01T10:00:00Z", [widget("a", two(missing))])]), { cartLive: false, plansLive: false });
    expect(best(["avocados"])).toContain("at Cheap, Full; best €20.00 at Full");
    expect(best([])).toContain("best $10.00 at Cheap");
  });

  it("drops the cart line while the session has a cart and the plan lines while it has plans", () => {
    expect(earlierNote(cards, { cartLive: true, plansLive: false })).not.toContain("cart (shown");
    expect(earlierNote(cards, { cartLive: false, plansLive: true })).not.toContain("trip big-sur");
    expect(earlierNote(cards, { cartLive: true, plansLive: true })).toBeUndefined();
    expect(earlierNote(undefined, { cartLive: false, plansLive: false })).toBeUndefined();
    expect(earlierNote({ plans: [] }, { cartLive: false, plansLive: false })).toBeUndefined();
  });

  it("keeps the card lines within 600 characters", () => {
    const long = (id: string) => ({ ...event(id), value: { title: "x".repeat(400), guests: 12 } });
    const many = earlierCards([row("2026-11-01T10:00:00Z", [widget("a", long("a")), widget("b", long("b")), widget("c", long("c"))])]);
    const note = earlierNote(many, { cartLive: false, plansLive: false })!;
    const body = note.split("\n").slice(2, -1).join("\n");
    expect(body.length).toBeLessThanOrEqual(600);
    expect(body.endsWith("…")).toBe(true);
  });
});

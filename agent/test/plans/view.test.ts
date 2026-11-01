import { describe, expect, it } from "vitest";
import { validateWidget } from "../../../shared/widgets.js";
import { entityKey } from "../../../shared/workspace.js";
import { planSummary, planWidget } from "../../src/plans/view.js";
import { cartWidget } from "../../src/render/cart.js";
import { entityDetail, summarize } from "../../src/workspace/summary.js";
import { cartValue, tripValue } from "../fixtures/plans.js";
import { CHAT_1 } from "../fixtures/users.js";

const at = (kind: "cart" | "trip" | "event" | "shortlist", id: string, value: unknown) => ({
  chatId: CHAT_1,
  kind,
  id,
  value,
  version: 2,
  updatedAt: 1_700_000_000_000,
});

describe("plan view", () => {
  it("titles and lines per kind, with no internal id in the line", () => {
    expect(planSummary(at("trip", "t1", tripValue), "Big Sur chat")).toMatchObject({
      title: "Big Sur",
      line: "Big Sur, 2026-11-14 to 2026-11-16, 2 travelers, budget $900, 1 stays shortlisted, 1 days planned",
      chatTitle: "Big Sur chat",
      key: entityKey("t1"),
      version: 2,
      updatedAt: "2023-11-14T22:13:20.000Z",
    });
    expect(planSummary(at("event", "e1", { title: "Diwali", guests: 20 }), "").title).toBe("Diwali");
    expect(planSummary(at("event", "e1", { title: "Diwali", guests: 20 }), "  ").chatTitle).toBe("Untitled chat");
    expect(planSummary(at("shortlist", "s1", { title: "Cafes", items: [] }), "x")).toMatchObject({
      title: "Cafes",
      line: "Cafes, 0 items",
    });
    expect(planSummary(at("cart", "cart", cartValue), "x").title).toBe("Cart · Trader Joe's");
  });

  it("keeps the model summary unchanged while entityDetail drops the kind and id", () => {
    const trip = { kind: "trip" as const, id: "t1", value: tripValue };
    expect(summarize([trip])).toBe(`trip t1: ${entityDetail(trip)}`);
    expect(summarize([{ kind: "cart", id: "cart", value: cartValue }])).toMatch(/^cart: 2 items at Trader Joe's/);
    expect(entityDetail(trip)).not.toMatch(/^trip/);
  });

  it("builds widgets that pass validateWidget", () => {
    const cart = cartWidget(cartValue);
    expect(cart && validateWidget(cart).ok).toBe(true);
    expect(cart?.stores[0]).toMatchObject({ name: "Trader Joe's", total: 10.74, url: "https://www.traderjoes.com/" });
    const trip = planWidget(at("trip", "t1", tripValue));
    expect(trip && validateWidget(trip).ok).toBe(true);
    expect(planWidget(at("trip", "t1", { destination: "x" }))).toBeNull();
    expect(cartWidget({ ...cartValue, picks: {} })).toBeNull();
  });
});

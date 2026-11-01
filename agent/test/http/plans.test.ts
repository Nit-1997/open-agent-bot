import { describe, expect, it } from "vitest";
import { validateWidget } from "../../../shared/widgets.js";
import { entityKey } from "../../../shared/workspace.js";
import { makeApp } from "../fixtures/app.js";
import { cartValue, tripValue } from "../fixtures/plans.js";
import { ALICE, BOB, CHAT_1, CHAT_2 } from "../fixtures/users.js";

async function seeded() {
  const h = await makeApp();
  const r = h.db.forUser(ALICE.id);
  await r.chats.claim(CHAT_1, {});
  await r.chats.touch(CHAT_1, { titleIfEmpty: "Weekend in Big Sur" });
  await r.chats.claim(CHAT_2, {});
  await r.workspace.put(CHAT_1, "trip", "t1", tripValue);
  await r.workspace.put(CHAT_2, "cart", "cart", cartValue);
  await r.workspace.put(CHAT_2, "event", "e/1", { title: "Diwali", guests: 20 });
  return h;
}

type PlansBody = {
  items: Array<{ kind: string; title: string; line: string; chatTitle: string; key: string; entityId: string }>;
  total: number;
  counts: Record<string, number>;
};

describe("plan routes", () => {
  it("lists plans newest first across chats with per-kind counts", async () => {
    const { call } = await seeded();
    const body = (await (await call(ALICE, "/plans")).json()) as PlansBody;
    expect(body.total).toBe(3);
    expect(body.items.map((p) => p.kind)).toEqual(["event", "cart", "trip"]);
    expect(body.counts).toEqual({ cart: 1, trip: 1, event: 1, shortlist: 0, all: 3 });
    const trip = body.items[2];
    expect(trip).toMatchObject({ title: "Big Sur", chatTitle: "Weekend in Big Sur", key: entityKey("t1") });
    expect(trip.line).not.toContain("t1");
    expect(body.items[1]).toMatchObject({ title: "Cart · Trader Joe's", chatTitle: "Untitled chat" });
    expect(body.items[1].line).toBe("2 items at Trader Joe's (best $10.74 at Trader Joe's)");
  });

  it("filters by kind and keeps the counts", async () => {
    const { call } = await seeded();
    const body = (await (await call(ALICE, "/plans?kind=trip")).json()) as PlansBody;
    expect(body.items.map((p) => p.kind)).toEqual(["trip"]);
    expect(body.total).toBe(1);
    expect(body.counts.all).toBe(3);
    expect((await call(ALICE, "/plans?kind=boat")).status).toBe(400);
  });

  it("returns a trip as a plan widget and a cart as a cart widget", async () => {
    const { call } = await seeded();
    const trip = (await (await call(ALICE, `/plans/${CHAT_1}/trip/${entityKey("t1")}`)).json()) as {
      widget: unknown;
      plan: { title: string };
    };
    expect(trip.plan.title).toBe("Big Sur");
    expect(trip.widget).toMatchObject({ kind: "plan", entity: "trip", id: "t1" });
    expect(validateWidget(trip.widget).ok).toBe(true);
    const cart = (await (await call(ALICE, `/plans/${CHAT_2}/cart/${entityKey("cart")}`)).json()) as { widget: { kind: string } };
    expect(cart.widget.kind).toBe("cart");
    expect(validateWidget(cart.widget).ok).toBe(true);
    const slash = await call(ALICE, `/plans/${CHAT_2}/event/${entityKey("e/1")}`);
    expect(slash.status).toBe(200);
  });

  it("answers 404 for every bad parameter and for another user's plan", async () => {
    const { call } = await seeded();
    const k = entityKey("t1");
    for (const path of [
      `/plans/not-a-uuid/trip/${k}`,
      `/plans/${CHAT_1}/boat/${k}`,
      `/plans/${CHAT_1}/trip/!!`,
      `/plans/${CHAT_1}/trip/${entityKey("..")}`,
      `/plans/${CHAT_1}/trip/dDF`,
      `/plans/${CHAT_1}/trip/${entityKey("x".repeat(101))}`,
      `/plans/${CHAT_1}/cart/${k}`,
    ])
      expect((await call(ALICE, path)).status, path).toBe(404);
    expect((await call(BOB, `/plans/${CHAT_1}/trip/${k}`)).status).toBe(404);
  });

  it("answers 422 invalid_plan for a stored value the app can't show and still lists it", async () => {
    const { call, db } = await seeded();
    const r = db.forUser(ALICE.id);
    await r.workspace.put(CHAT_1, "trip", "old", { destination: "Nowhere" });
    const res = await call(ALICE, `/plans/${CHAT_1}/trip/${entityKey("old")}`);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "invalid_plan" });
    const list = (await (await call(ALICE, "/plans?kind=trip")).json()) as PlansBody;
    expect(list.items[0]).toMatchObject({ title: "Saved trip", line: "This plan can't be summarised." });
  });
});

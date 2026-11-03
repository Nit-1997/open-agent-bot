import { describe, expect, it } from "vitest";
import { applyPatch } from "@oab/shared/workspace";
import { planTool } from "../../src/tools/plan.js";
import { WorkspaceStore } from "../../src/workspace/store.js";
import { textOf } from "../fixtures/toolResult.js";

function setup() {
  const store = new WorkspaceStore();
  const tool = planTool({ store });
  const run = async (params: Record<string, unknown>) => tool.execute("c", params as never, undefined, undefined, {} as never);
  return { store, run };
}
const party = { title: "8th birthday", guests: 12, budget: 300, menu: ["pizza"] };

describe("plan tool", () => {
  it("sets an entity, saves it and shows a plan card", async () => {
    const { store, run } = setup();
    const r = await run({ action: "set", kind: "event", value: party });
    expect(r.isError).toBeUndefined();
    expect(await store.get("event", "main")).toMatchObject({ version: 1, value: party });
    expect(r.details.widget).toMatchObject({ kind: "plan", entity: "event", id: "main", version: 1, value: party });
    expect(textOf(r)).toMatch(/^Set event "main" \(version 1\)/);
  });

  it("accepts the value as a JSON string", async () => {
    const { store, run } = setup();
    await run({ action: "set", kind: "event", id: "bday", value: JSON.stringify(party) });
    expect((await store.get("event", "bday"))?.value).toEqual(party);
  });

  it("rejects an invalid entity with the failing paths and saves nothing", async () => {
    const { store, run } = setup();
    const r = await run({ action: "set", kind: "event", value: { title: "x", guests: 0 } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("/guests");
    expect(await store.list()).toEqual([]);
  });

  it("patches with replace, add and remove, validates the result and bumps the version", async () => {
    const { store, run } = setup();
    await run({ action: "set", kind: "event", value: party });
    const r = await run({
      action: "patch",
      kind: "event",
      ops: [
        { op: "replace", path: "/guests", value: 16 },
        { op: "add", path: "/menu/-", value: "cake" },
        { op: "add", path: "/theme", value: "space" },
        { op: "remove", path: "/budget" },
      ],
    });
    expect(r.isError).toBeUndefined();
    expect(await store.get("event", "main")).toMatchObject({
      version: 2,
      value: { title: "8th birthday", guests: 16, menu: ["pizza", "cake"], theme: "space" },
    });
    expect((await store.get("event", "main"))?.value).not.toHaveProperty("budget");
    expect(r.details.widget).toMatchObject({ version: 2 });
  });

  it("leaves the entity untouched when a patch breaks the schema or points nowhere", async () => {
    const { store, run } = setup();
    await run({ action: "set", kind: "event", value: party });
    const bad = await run({ action: "patch", kind: "event", ops: [{ op: "replace", path: "/guests", value: "many" }] });
    const missing = await run({ action: "patch", kind: "event", ops: [{ op: "replace", path: "/nope", value: 1 }] });
    const noValue = await run({ action: "patch", kind: "event", ops: [{ op: "add", path: "/theme" }] });
    const unknownOp = await run({ action: "patch", kind: "event", ops: [{ op: "move", path: "/theme" }] });
    const required = await run({ action: "patch", kind: "event", ops: [{ op: "remove", path: "/guests" }] });
    for (const r of [bad, missing, noValue, unknownOp, required]) expect(r.isError).toBe(true);
    expect(textOf(bad)).toContain("invalid");
    expect(await store.get("event", "main")).toMatchObject({ version: 1, value: party });
  });

  it("patching an entity that does not exist asks for set first", async () => {
    const { run } = setup();
    const r = await run({ action: "patch", kind: "trip", ops: [{ op: "replace", path: "/travelers", value: 3 }] });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe('No trip "main" in this session yet; use set first.');
  });

  it("gets one entity or all of a kind", async () => {
    const { run } = setup();
    await run({ action: "set", kind: "event", id: "a", value: party });
    await run({ action: "set", kind: "event", id: "b", value: { ...party, guests: 3 } });
    expect(textOf(await run({ action: "get", kind: "event", id: "b" }))).toContain('"guests":3');
    expect(textOf(await run({ action: "get", kind: "event" }))).toContain('event "a"');
    expect(textOf(await run({ action: "get", kind: "trip" }))).toBe("No trip in this session yet.");
    expect(textOf(await run({ action: "get", kind: "event", id: "zz" }))).toBe('No event "zz" in this session.');
  });

  it("reads the cart but never writes it", async () => {
    const { run } = setup();
    expect((await run({ action: "set", kind: "cart", value: {} })).isError).toBe(true);
    expect((await run({ action: "patch", kind: "cart", ops: [] })).isError).toBe(true);
  });

  it("validates trips and shortlists, with the card for shortlists too", async () => {
    const { run } = setup();
    const trip = {
      destination: "Tahoe",
      start: "2026-12-01",
      end: "2026-12-04",
      travelers: 2,
      stays: [],
      days: [{ date: "2026-12-01", items: ["ski"] }],
    };
    expect((await run({ action: "set", kind: "trip", value: trip })).details.widget).toMatchObject({ entity: "trip" });
    expect((await run({ action: "set", kind: "trip", value: { ...trip, travelers: 0 } })).isError).toBe(true);
    expect(
      (await run({ action: "set", kind: "shortlist", value: { title: "Gifts", items: [{ name: "Lego", price: 20 }] } })).details.widget,
    ).toMatchObject({ entity: "shortlist" });
  });

  it("describes when to patch instead of rebuilding", () => {
    const { store } = setup();
    const description = planTool({ store }).description;
    expect(description).toContain("make it 16 kids");
    expect(description).toContain("Never rebuild the plan or re-search unchanged items");
    expect(description).toMatch(/^This chat's plans for the current session:/);
    expect(description).toContain("they last for this session only and aren't saved anywhere else.");
    expect(description).not.toContain("saved plan state");
  });
});

describe("applyPatch", () => {
  it("does not mutate the input and handles pointer escapes", () => {
    const doc = { "a/b": { "c~d": [1, 2] } };
    const r = applyPatch(doc, [{ op: "add", path: "/a~1b/c~0d/1", value: 9 }]);
    expect(r).toEqual({ ok: true, value: { "a/b": { "c~d": [1, 9, 2] } } });
    expect(doc["a/b"]["c~d"]).toEqual([1, 2]);
  });

  it("refuses prototype keys and bad pointers", () => {
    expect(applyPatch({}, [{ op: "add", path: "/__proto__/x", value: 1 }]).ok).toBe(false);
    expect(applyPatch({}, [{ op: "add", path: "x", value: 1 }]).ok).toBe(false);
    expect(applyPatch([1], [{ op: "replace", path: "/5", value: 1 }]).ok).toBe(false);
  });

  it("refuses a new plan once the session holds 50", async () => {
    const { store, run } = setup();
    for (let i = 0; i < 50; i++) await store.put("event", `e${i}`, party);
    const r = await run({ action: "set", kind: "event", id: "e50", value: party });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe("This session already holds 50 plans. Update one of them instead of adding another.");
    expect((await run({ action: "set", kind: "event", id: "e1", value: party })).isError).toBeUndefined();
  });
});

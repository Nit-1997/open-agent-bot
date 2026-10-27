import { describe, expect, it } from "vitest";
import { validateWidget } from "../../../shared/widgets.js";
import { showFlightsTool, showPlanTool, showProductsTool } from "../../src/tools/showWidget.js";
import { validWidgets } from "../fixtures/widgets.js";

const strip = ({ kind: _k, ...rest }: Record<string, unknown>) => rest;
const exec = (tool: { execute: (...a: never[]) => Promise<unknown> }, params: unknown) =>
  tool.execute(...(["c", params, undefined, undefined, {}] as never[])) as Promise<{
    isError?: boolean;
    content: Array<{ text: string }>;
    details: { widget?: unknown };
  }>;

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
});

describe("flat show_* tools", () => {
  const cases = [
    ["show_products", showProductsTool(), validWidgets.product_comparison],
    ["show_flights", showFlightsTool(), validWidgets.flight_list],
    ["show_plan", showPlanTool(), validWidgets.plan_checklist],
  ] as const;

  for (const [name, tool, widget] of cases) {
    it(`${name} takes top-level fields and returns a valid details.widget`, async () => {
      expect(tool.name).toBe(name);
      const res = await exec(tool, strip(widget as Record<string, unknown>));
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toBe(`shown to the user as a ${widget.kind} card`);
      expect(res.details.widget).toEqual(widget);
      expect(validateWidget(res.details.widget).ok).toBe(true);
    });
  }

  it("show_widget rejects invalid payload with path-level errors", async () => {
    const bad = { ...strip(validWidgets.product_comparison), rows: [{ ...validWidgets.product_comparison.rows[0], availability: "maybe" }] };
    const res = await exec(showProductsTool(), bad);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/^invalid widget:/);
    expect(res.content[0].text).toContain("/rows/0/availability");
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

import { describe, expect, it } from "vitest";
import { validateWidget } from "../../../shared/widgets.js";
import { showWidgetTool } from "../../src/tools/showWidget.js";
import { validWidgets } from "../fixtures/widgets.js";

const run = (widget: unknown) =>
  showWidgetTool().execute("call_1", { widget } as never, undefined, undefined, {} as never);

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

describe("show_widget tool", () => {
  it("accepts valid payload for each kind", async () => {
    for (const w of Object.values(validWidgets)) {
      const res = await run(w);
      expect(res.isError).toBeFalsy();
      expect(res.content[0]).toMatchObject({ type: "text", text: `rendered ${w.kind}` });
    }
  });

  it("show_widget rejects invalid payload with path-level errors", async () => {
    const bad = {
      ...validWidgets.product_comparison,
      rows: [{ ...validWidgets.product_comparison.rows[0], availability: "maybe" }],
    };
    const res = await run(bad);
    expect(res.isError).toBe(true);
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/^invalid widget:/);
    expect(text).toContain("/rows/0/availability");
  });
});

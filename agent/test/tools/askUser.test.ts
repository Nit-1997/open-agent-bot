import { describe, expect, it } from "vitest";
import { validateWidget } from "../../../shared/widgets.js";
import { askUserTool } from "../../src/tools/askUser.js";

const exec = (params: unknown) =>
  askUserTool().execute(...(["c", params, undefined, undefined, {}] as never[])) as Promise<{
    isError?: boolean;
    content: Array<{ text: string }>;
    details: { widget?: unknown };
  }>;

const fields = [
  { type: "date_range", label: "Travel dates", start: "2026-11-25", end: "2026-11-29" },
  { type: "number", label: "Travelers", value: 2, min: 1, max: 9 },
  { type: "choice", label: "Budget", options: ["Saver", "Comfort", "Splurge"], value: "Comfort" },
  { type: "text", label: "Flying from", value: "SJC" },
];

describe("ask_user", () => {
  it("shows a prefilled form and tells the model to stop and wait", async () => {
    const res = await exec({ question: "When are you going?", fields });
    expect(res.isError).toBeFalsy();
    expect(res.details.widget).toEqual({ kind: "ask", question: "When are you going?", fields });
    expect(res.content[0].text).toMatch(/end your reply now/i);
  });

  it("accepts fields sent as a JSON string", async () => {
    const res = await exec({ question: "Dates?", fields: JSON.stringify(fields.slice(0, 1)) });
    expect(res.details.widget).toMatchObject({ fields: [{ type: "date_range" }] });
  });

  it("rejects a date range that ends before it starts, with the field path", async () => {
    const res = await exec({ question: "Dates?", fields: [{ type: "date_range", label: "Dates", start: "2026-11-29", end: "2026-11-25" }] });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("/fields/0/end");
  });

  it("rejects badly formatted dates and unknown field types", () => {
    const r = validateWidget({ kind: "ask", question: "q", fields: [{ type: "date_range", label: "d", start: "Nov 25", end: "2026-11-29" }, { type: "slider" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join("\n")).toContain("/fields/0/start");
      expect(r.errors.join("\n")).toContain("/fields/1/type: must be one of date_range, number, choice, text");
    }
  });
});

import { defineTool } from "@earendil-works/pi-coding-agent";
import { type TSchema, Type } from "typebox";
import {
  PlanChecklistSchema,
  ProductComparisonSchema,
  validateWidget,
  type WidgetKind,
} from "../../../shared/widgets.js";
import { fail, ok, type ToolResult } from "./result.js";

function flatWidgetTool(name: string, kind: WidgetKind, schema: TSchema, description: string) {
  return defineTool({
    name,
    label: name,
    description,
    parameters: Type.Omit(schema, ["kind"]) as TSchema,
    async execute(_id, params): Promise<ToolResult> {
      const r = validateWidget({ kind, ...(params as object) });
      if (!r.ok) return fail(`invalid widget:\n${r.errors.join("\n")}`);
      return ok(`shown to the user as a ${kind} card`, { widget: r.value });
    },
  });
}

export const showProductsTool = () =>
  flatWidgetTool(
    "show_products",
    "product_comparison",
    ProductComparisonSchema,
    "Show the user a product comparison card: one row per store with price, availability (in_stock, out_of_stock, unknown, or blocked when the site refused access) and the product URL. Only use prices and availability that tools returned.",
  );

export const showPlanTool = () =>
  flatWidgetTool(
    "show_plan",
    "plan_checklist",
    PlanChecklistSchema,
    "Show the user a checklist card for a plan, menu, or shopping list: sections, each with items (label, optional quantity, note, url).",
  );

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { validateWidget, WidgetSchema } from "../../../shared/widgets.js";
import { fail, ok, type ToolResult } from "./result.js";

export function showWidgetTool() {
  return defineTool({
    name: "show_widget",
    label: "Show widget",
    description:
      "Render structured results as a rich widget in the user's chat. Use kind weather_card for weather, flight_list for flights, product_comparison for product availability/prices across stores, plan_checklist for plans, menus, shopping lists. Only include data that tools actually returned.",
    parameters: Type.Object({ widget: WidgetSchema }),
    async execute(_id, params): Promise<ToolResult> {
      const r = validateWidget(params.widget);
      if (!r.ok) {
        return fail(`invalid widget:\n${r.errors.join("\n")}`);
      }
      return ok(`rendered ${r.value.kind}`, { kind: r.value.kind });
    },
  });
}

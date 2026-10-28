import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { UI_BLOCK_TYPES, validateWidget } from "../../../shared/widgets.js";
import { fail, ok, type ToolResult } from "./result.js";

const BLOCKS_HELP = `Blocks, in display order:
- {type:"heading", text}
- {type:"text", text}
- {type:"stats", items:[{label, value, note?}]} for a few key numbers
- {type:"table", columns:[...], rows:[[...]]} for comparisons; every cell is text
- {type:"list", items:[{title, subtitle?, value?, badge?, url?}]} for products, places, options
- {type:"checklist", title?, items:[{text, note?}]} for to-dos, shopping lists, menus
- {type:"links", items:[{label, url}]}
- {type:"callout", tone:"info"|"warning"|"success", text}`;

function textify(v: unknown): unknown {
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(textify);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "type" || k === "tone" ? x : textify(x)]));
  return v;
}

export const showUiTool = () =>
  defineTool({
    name: "show_ui",
    label: "show_ui",
    description: `Show the user a card you compose from blocks. Use it for comparisons, plans, menus, checklists, summaries, or anything easier to scan than prose. Only put prices, ratings, stock status, and links in it that a tool returned; anything else is marked unverified and unsourced links are removed.\n\n${BLOCKS_HELP}`,
    parameters: Type.Object({
      title: Type.String(),
      subtitle: Type.Optional(Type.String()),
      blocks: Type.Union([Type.Array(Type.Object({ type: Type.Enum(UI_BLOCK_TYPES) }, { additionalProperties: true })), Type.String()], {
        description: BLOCKS_HELP,
      }),
    }),
    async execute(_id, params): Promise<ToolResult> {
      let blocks: unknown = params.blocks;
      if (typeof blocks === "string") {
        try {
          blocks = JSON.parse(blocks);
        } catch {
          return fail("invalid card:\n/blocks: blocks must be an array of block objects, not text");
        }
      }
      const r = validateWidget({ kind: "ui", ...(textify({ ...params, blocks }) as object) });
      if (!r.ok) return fail(`invalid card:\n${r.errors.join("\n")}`);
      return ok("shown to the user as a card", { widget: r.value });
    },
  });

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ASK_FIELD_TYPES, validateWidget } from "@oab/shared/widgets";
import { fail, ok, type ToolResult } from "./result.js";

const FIELDS_HELP = `Fields, prefilled with your best guess so the user can just confirm:
- {type:"date_range", label, start:"YYYY-MM-DD", end:"YYYY-MM-DD"}
- {type:"number", label, value?, min?, max?}
- {type:"choice", label, options:[...2-8], value?}
- {type:"text", label, value?, placeholder?}`;

export const askUserTool = () =>
  defineTool({
    name: "ask_user",
    label: "ask_user",
    description: `Show the user a short form to confirm details you need before searching: dates, number of travelers or guests, a budget level, a starting city. Prefill every field with your best guess from context. After calling it, end your reply; their answers arrive as their next message.\n\nUse it once when a trip, event, or purchase depends on details not given (dates, travelers or guests, starting city, budget), then end your reply; don't search until they answer, and don't ask for what they gave.`,
    parameters: Type.Object({
      question: Type.String({ description: "one short sentence, e.g. 'Which dates should I plan around?'" }),
      fields: Type.Union([Type.Array(Type.Object({ type: Type.Enum(ASK_FIELD_TYPES) }, { additionalProperties: true })), Type.String()], {
        description: FIELDS_HELP,
      }),
      submit_label: Type.Optional(Type.String()),
    }),
    async execute(_id, params): Promise<ToolResult> {
      let fields: unknown = params.fields;
      if (typeof fields === "string") {
        try {
          fields = JSON.parse(fields);
        } catch {
          return fail("invalid form:\n/fields: must be an array of field objects, not text");
        }
      }
      const r = validateWidget({
        kind: "ask",
        question: params.question,
        fields,
        ...(params.submit_label && { submitLabel: params.submit_label }),
      });
      if (!r.ok) return fail(`invalid form:\n${r.errors.join("\n")}`);
      return ok(
        "The form is shown to the user. End your reply now with at most one short sentence; their answers arrive as their next message.",
        {
          widget: r.value,
        },
      );
    },
  });

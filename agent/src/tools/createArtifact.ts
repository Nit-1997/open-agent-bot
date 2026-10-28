import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { withReportFrame } from "../artifacts/frame.js";
import type { ArtifactStore } from "../artifacts/store.js";
import { fail, ok, type ToolResult } from "./result.js";

const MAX_HTML_BYTES = 2_000_000;

export function createArtifactTool(artifacts: ArtifactStore) {
  return defineTool({
    name: "create_artifact",
    label: "Create artifact",
    description:
      "Save a complete, self-contained HTML document (inline CSS, no external scripts) as a report shown inline in the chat as a scrollable page, which the user can also open in a new tab, full screen, or as a PDF. Use for research, guides, comparisons of approaches, printable plans, and pages the user asks for. Clean typography, tables and link styles are added for you; write semantic HTML (h1, h2, p, ul, table, a) and add CSS only for anything special. Links open in a new tab.",
    parameters: Type.Object({
      title: Type.String({ minLength: 1, maxLength: 120 }),
      html: Type.String({ minLength: 1 }),
    }),
    async execute(_id, params): Promise<ToolResult> {
      if (Buffer.byteLength(params.html) > MAX_HTML_BYTES) {
        return fail("html too large (max 2MB)");
      }
      const { id } = await artifacts.save(params.title, withReportFrame(params.html));
      return ok(`artifact ${id} created: ${params.title}`, { artifactId: id, title: params.title });
    },
  });
}

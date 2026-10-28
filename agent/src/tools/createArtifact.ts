import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { withReportFrame } from "../artifacts/frame.js";
import { type ImageCheck, vetImages } from "../artifacts/images.js";
import { REPORT_GUIDE } from "../artifacts/reportKit.js";
import type { ArtifactStore } from "../artifacts/store.js";
import { fail, ok, type ToolResult } from "./result.js";

const MAX_HTML_BYTES = 2_000_000;

export function createArtifactTool(artifacts: ArtifactStore, images?: ImageCheck) {
  return defineTool({
    name: "create_artifact",
    label: "Create artifact",
    description: `Save a complete, self-contained HTML document (no scripts from other sites) as a rich report shown inline in the chat as a scrollable page, which the user can also open in a new tab, full screen, or as a PDF. Use for research, guides, comparisons, printable plans, and pages the user asks for. Make it look like a magazine feature, not a document: lead with a hero picture and the verdict, use pictures for every product, place, or option, numbers as stat tiles, and comparisons as option cards, tables, and bar charts.\n\n${REPORT_GUIDE}`,
    parameters: Type.Object({
      title: Type.String({ minLength: 1, maxLength: 120 }),
      html: Type.String({ minLength: 1 }),
    }),
    async execute(_id, params): Promise<ToolResult> {
      if (Buffer.byteLength(params.html) > MAX_HTML_BYTES) {
        return fail("html too large (max 2MB)");
      }
      const vetted = images ? await vetImages(params.html, images) : { html: params.html, kept: 0, dropped: 0 };
      const { id } = await artifacts.save(params.title, withReportFrame(vetted.html));
      const pictures = vetted.dropped
        ? ` ${vetted.kept} pictures shown; ${vetted.dropped} removed because no tool returned them or they didn't load.`
        : vetted.kept
          ? ` ${vetted.kept} pictures shown.`
          : "";
      return ok(`artifact ${id} created: ${params.title}${pictures}`, { artifactId: id, title: params.title });
    },
  });
}

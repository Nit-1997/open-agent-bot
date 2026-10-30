import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { withReportFrame } from "../artifacts/frame.js";
import { type ImageCheck, vetImages } from "../artifacts/images.js";
import { REPORT_GUIDE } from "../artifacts/reportKit.js";
import type { ArtifactStore } from "../artifacts/store.js";
import { fail, ok, type ToolResult } from "./result.js";

const MAX_HTML_BYTES = 2_000_000;

const LEAD_CHARS = 6000;

export function leadsWithPicture(html: string): boolean {
  const body = html.replace(/^[\s\S]*?<body[^>]*>/i, "");
  const first = body.search(/<img\b/i);
  return first !== -1 && first < LEAD_CHARS;
}

function addHero(html: string, src: string, alt: string): string {
  const img = `<img src="${src.replace(/"/g, "&quot;")}" alt="${alt.replace(/[<>"]/g, "")}">`;
  const header = /<header\b[^>]*class="[^"]*\bhero\b[^"]*"[^>]*>/i.exec(html);
  if (header) {
    const close = html.indexOf("</header>", header.index);
    if (close !== -1) return `${html.slice(0, close)}${img}${html.slice(close)}`;
  }
  const h1 = /<\/h1>/i.exec(html);
  if (h1) return `${html.slice(0, h1.index + 5)}<figure class="hero">${img}</figure>${html.slice(h1.index + 5)}`;
  return html.replace(/(<body[^>]*>)/i, `$1<figure class="hero">${img}</figure>`);
}

function firstPicture(html: string): { src: string; alt: string } | undefined {
  const m = /<img\b[^>]*\bsrc="([^"]+)"[^>]*>/i.exec(html);
  if (!m) return undefined;
  const alt = /\balt="([^"]*)"/i.exec(m[0])?.[1] ?? "";
  return { src: m[1], alt };
}

export async function storeArtifact(artifacts: ArtifactStore, images: ImageCheck | undefined, title: string, html: string): Promise<ToolResult> {
  if (Buffer.byteLength(html) > MAX_HTML_BYTES) {
    return fail("html too large (max 2MB)");
  }
  const vetted = images ? await vetImages(html, images) : { html, kept: 0, dropped: 0 };
  const lead = vetted.kept > 0 && !leadsWithPicture(vetted.html) ? firstPicture(vetted.html) : undefined;
  if (lead) vetted.html = addHero(vetted.html, lead.src, lead.alt || title);
  const { id } = await artifacts.save(title, withReportFrame(vetted.html));
  const pictures = vetted.dropped
    ? ` ${vetted.kept} pictures shown; ${vetted.dropped} removed because no tool returned them or they didn't load.`
    : vetted.kept
      ? ` ${vetted.kept} pictures shown.`
      : "";
  return ok(`artifact ${id} created: ${title}${pictures}`, { artifactId: id, title });
}

export function createArtifactTool(artifacts: ArtifactStore, images?: ImageCheck) {
  return defineTool({
    name: "create_artifact",
    label: "Create artifact",
    description: `Save a complete, self-contained HTML document (no scripts from other sites) as a rich report shown inline in the chat as a scrollable page, which the user can also open in a new tab, full screen, or as a PDF. Use for research, guides, comparisons, printable plans, and pages the user asks for. Make it look like a magazine feature, not a document: lead with a hero picture and the verdict, use pictures for every product, place, or option, numbers as stat tiles, and comparisons as option cards, tables, and bar charts.\n\n${REPORT_GUIDE}`,
    parameters: Type.Object({
      title: Type.String({ minLength: 1, maxLength: 120 }),
      html: Type.String({ minLength: 1 }),
    }),
    execute: (_id, params): Promise<ToolResult> => storeArtifact(artifacts, images, params.title, params.html),
  });
}

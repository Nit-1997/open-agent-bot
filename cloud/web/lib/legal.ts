import { readFileSync } from "node:fs";
import { join } from "node:path";

export const LEGAL_DRAFT_MARKER = "DRAFT-NOT-REVIEWED";
export const LEGAL_DOCS = ["terms", "privacy"] as const;
export type LegalName = (typeof LEGAL_DOCS)[number];

export type LegalBlock = { kind: "h2" | "h3" | "p"; text: string } | { kind: "ul"; items: string[] };
export type LegalDoc = { title: string; draft: boolean; blocks: LegalBlock[] };

const COMMENT_RE = /<!--[\s\S]*?-->/g;

export function parseLegal(markdown: string): LegalDoc {
  const draft = markdown.includes(LEGAL_DRAFT_MARKER);
  const lines = markdown.replace(COMMENT_RE, "").split(/\r?\n/);
  let title = "";
  const blocks: LegalBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "p", text: paragraph.join(" ") });
    if (list) blocks.push({ kind: "ul", items: list });
    paragraph = [];
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const item = /^[-*]\s+(.+)$/.exec(line);
    if (!line) flush();
    else if (heading) {
      flush();
      const [, hashes, text] = heading;
      if (hashes!.length === 1 && !title) title = text!;
      else blocks.push({ kind: hashes!.length <= 2 ? "h2" : "h3", text: text! });
    } else if (item) {
      if (paragraph.length) flush();
      list = [...(list ?? []), item[1]!];
    } else {
      if (list) flush();
      paragraph.push(line);
    }
  }
  flush();
  if (!title) throw new Error("a legal document needs a '# Title' line");
  return { title, draft, blocks };
}

export function loadLegal(name: LegalName, dir: string = join(process.cwd(), "content")): LegalDoc {
  return parseLegal(readFileSync(join(dir, `${name}.md`), "utf8"));
}

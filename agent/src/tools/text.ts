import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export const MAX_PAGE_CHARS = 12000;

const BLOCKS = "p,div,li,ul,ol,tr,table,section,article,h1,h2,h3,h4,h5,h6,br,hr,blockquote,pre,dt,dd,header,footer,main,form";

export function truncate(s: string, max = MAX_PAGE_CHARS): string {
  return s.length <= max ? s : `${s.slice(0, max)}\n[truncated]`;
}

function blockText(root: { querySelectorAll: (s: string) => Iterable<any>; ownerDocument?: any; textContent: string | null }, doc: any): string {
  const walker = doc.createTreeWalker(root, 4);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) n.textContent = n.textContent.replace(/\s+/g, " ");
  for (const el of root.querySelectorAll(BLOCKS)) el.after(doc.createTextNode("\n"));
  return (root.textContent ?? "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlToText(html: string): string {
  const { document } = parseHTML(html);
  for (const el of document.querySelectorAll("script,style,noscript,svg,iframe,template")) el.remove();
  try {
    const article = new Readability(document.cloneNode(true) as unknown as Document).parse();
    if (article?.content) {
      const { document: adoc } = parseHTML(`<html><body>${article.content}</body></html>`);
      const t = blockText(adoc.body, adoc);
      if (t.length > 200) return t;
    }
  } catch {}
  for (const el of document.querySelectorAll("nav,footer,header,aside")) el.remove();
  return blockText(document.body, document);
}

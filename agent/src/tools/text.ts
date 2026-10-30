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

const MAX_IMAGES = 24;
const SKIP_ALT = /\b(logo|icon|avatar|sprite|banner|badge)\b/i;
const SKIP_SRC = /(icon|logo|sprite|favicon)[^/]*$/i;

type PageImage = { alt: string; src: string };

function absolute(src: string | null | undefined, base: string): string | null {
  if (!src || src.startsWith("data:")) return null;
  try {
    const u = new URL(src.trim().split(/\s+/)[0], base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

function ldProducts(v: unknown, out: Array<{ name?: string; image?: unknown }> = []): Array<{ name?: string; image?: unknown }> {
  if (Array.isArray(v)) for (const x of v) ldProducts(x, out);
  else if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const type = o["@type"];
    if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) out.push({ name: o.name as string | undefined, image: o.image });
    for (const [k, x] of Object.entries(o)) if (k !== "image") ldProducts(x, out);
  }
  return out;
}

function firstImage(image: unknown): string | undefined {
  if (typeof image === "string") return image;
  if (Array.isArray(image)) return firstImage(image[0]);
  if (image && typeof image === "object") return (image as { url?: string }).url;
  return undefined;
}

export function pageImages(html: string, base: string, limit = MAX_IMAGES): PageImage[] {
  const { document } = parseHTML(html);
  const found: PageImage[] = [];
  const add = (alt: string | null | undefined, src: string | null | undefined) => {
    const a = (alt ?? "").replace(/\s+/g, " ").trim();
    const s = absolute(src, base);
    if (!s || a.length < 6 || SKIP_ALT.test(a) || /\.svg(\?|$)/i.test(s) || SKIP_SRC.test(new URL(s).pathname) || found.some((f) => f.src === s)) return;
    found.push({ alt: a.slice(0, 80), src: s });
  };
  const meta = (p: string) => document.querySelector(`meta[property="${p}"],meta[name="${p}"]`)?.getAttribute("content");
  add(meta("og:title") ?? document.title, meta("og:image"));
  for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      for (const p of ldProducts(JSON.parse(el.textContent ?? ""))) add(p.name, firstImage(p.image));
    } catch {}
  }
  for (const img of document.querySelectorAll("img")) {
    const w = Number(img.getAttribute("width")), h = Number(img.getAttribute("height"));
    if ((w && w < 50) || (h && h < 50)) continue;
    const src = [img.getAttribute("src"), img.getAttribute("data-src"), img.getAttribute("srcset")].find((x) => x && !x.startsWith("data:"));
    add(img.getAttribute("alt"), src);
  }
  return found.slice(0, limit);
}

const flat = (s: string) => s.replace(/\s+/g, " ").toLowerCase();

export function imagesText(html: string, base: string, visible: string): string {
  const seen = flat(visible);
  const images = pageImages(html, base, Infinity)
    .filter((i) => seen.includes(flat(i.alt).slice(0, 24)))
    .slice(0, MAX_IMAGES);
  return images.length ? `\n\nimages:\n${images.map((i) => `- ${i.alt} — ${i.src}`).join("\n")}` : "";
}

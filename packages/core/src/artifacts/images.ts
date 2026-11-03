import { parseHTML } from "linkedom";
import { mapLimit } from "../lib/concurrency.js";
import { fetchPublic, timeoutSignal } from "../lib/net.js";
import { guardedFetch } from "../lib/safeFetch.js";

const THUMBNAIL = /^https:\/\/encrypted-tbn\d\.gstatic\.com\//i;
const IMAGE_TYPE = /^image\/(png|jpe?g|gif|webp|avif|svg\+xml)$/;

export const MAX_IMAGE_BYTES = 500_000;
export const MAX_INLINE_BYTES = 1_500_000;

export type InlineImage = { dataUrl: string; bytes: number };
export type ImageCheck = { isSourced: (url: string) => boolean; inline: (url: string) => Promise<InlineImage | undefined> };

async function readUpTo(res: Response, max: number): Promise<Buffer | undefined> {
  if (!res.body) return undefined;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(value);
  }
}

export function inlineImage(f: typeof fetch = guardedFetch) {
  return async (url: string): Promise<InlineImage | undefined> => {
    try {
      const { res } = await fetchPublic(f, url, { signal: timeoutSignal(6000), headers: { accept: "image/*" } });
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!res.ok || !IMAGE_TYPE.test(type)) {
        await res.body?.cancel().catch(() => {});
        return undefined;
      }
      const bytes = await readUpTo(res, MAX_IMAGE_BYTES);
      if (!bytes?.length) return undefined;
      return { dataUrl: `data:${type};base64,${bytes.toString("base64")}`, bytes: bytes.length };
    } catch {
      return undefined;
    }
  };
}

export async function vetImages(html: string, check: ImageCheck): Promise<{ html: string; kept: number; dropped: number }> {
  const full = /<html[\s>]/i.test(html);
  const { document } = parseHTML(full ? html : `<!doctype html><html><head></head><body>${html}</body></html>`);
  const images = [...document.querySelectorAll("img")];
  for (const node of document.querySelectorAll("[srcset]")) node.removeAttribute("srcset");
  for (const node of document.querySelectorAll("picture source")) node.remove();
  const fetched = await mapLimit(images, 6, async (img): Promise<string | InlineImage | undefined> => {
    const src = (img.getAttribute("src") ?? "").trim();
    if (/^data:image\//i.test(src)) return src;
    if (THUMBNAIL.test(src) || !/^https?:\/\//i.test(src) || !check.isSourced(src)) return undefined;
    return check.inline(src);
  });
  let budget = MAX_INLINE_BYTES;
  let dropped = 0;
  images.forEach((img, i) => {
    const got = fetched[i];
    if (typeof got === "string") return;
    if (got && got.bytes <= budget) {
      budget -= got.bytes;
      img.setAttribute("src", got.dataUrl);
      return;
    }
    dropped++;
    const figure = img.closest("figure");
    if (figure && figure.querySelectorAll("img").length === 1) figure.remove();
    else img.remove();
  });
  const out = full ? document.toString() : document.body.innerHTML;
  return { html: out, kept: images.length - dropped, dropped };
}

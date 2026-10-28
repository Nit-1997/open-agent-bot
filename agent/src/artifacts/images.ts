import { parseHTML } from "linkedom";
import { mapLimit } from "../lib/concurrency.js";
import { fetchPublic, timeoutSignal } from "../tools/net.js";

const THUMBNAIL = /^https:\/\/encrypted-tbn\d\.gstatic\.com\//i;

export type ImageCheck = { isSourced: (url: string) => boolean; loads: (url: string) => Promise<boolean> };

export function imageLoads(f: typeof fetch = fetch) {
  return async (url: string): Promise<boolean> => {
    try {
      const { res } = await fetchPublic(f, url, { signal: timeoutSignal(6000), headers: { accept: "image/*" } });
      await res.body?.cancel().catch(() => {});
      return res.ok && (res.headers.get("content-type") ?? "").toLowerCase().startsWith("image/");
    } catch {
      return false;
    }
  };
}

export async function vetImages(html: string, check: ImageCheck): Promise<{ html: string; kept: number; dropped: number }> {
  const full = /<html[\s>]/i.test(html);
  const { document } = parseHTML(full ? html : `<!doctype html><html><head></head><body>${html}</body></html>`);
  const images = [...document.querySelectorAll("img")];
  const verdicts = await mapLimit(images, 6, async (img) => {
    const src = (img.getAttribute("src") ?? "").trim();
    if (/^data:image\//i.test(src)) return true;
    if (THUMBNAIL.test(src)) return false;
    return /^https?:\/\//i.test(src) && check.isSourced(src) && (await check.loads(src));
  });
  let dropped = 0;
  images.forEach((img, i) => {
    if (verdicts[i]) return;
    dropped++;
    const figure = img.closest("figure");
    if (figure && figure.querySelectorAll("img").length === 1) figure.remove();
    else img.remove();
  });
  const out = full ? document.toString() : document.body.innerHTML;
  return { html: out, kept: images.length - dropped, dropped };
}

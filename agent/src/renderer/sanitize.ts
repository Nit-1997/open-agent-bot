import { parseHTML } from "linkedom";

const HINTS = new Set(["prefetch", "prerender", "preconnect", "dns-prefetch", "modulepreload"]);

export function stripForRender(html: string): string {
  const full = /<html[\s>]/i.test(html);
  const { document } = parseHTML(full ? html : `<!doctype html><html><head></head><body>${html}</body></html>`);
  const doomed = [
    ...[...document.querySelectorAll("link[rel]")].filter((el) =>
      (el.getAttribute("rel") ?? "")
        .toLowerCase()
        .split(/\s+/)
        .some((t) => HINTS.has(t)),
    ),
    ...[...document.querySelectorAll("script[type]")].filter(
      (el) => (el.getAttribute("type") ?? "").trim().toLowerCase() === "speculationrules",
    ),
    ...[...document.querySelectorAll("meta[http-equiv]")].filter(
      (el) => (el.getAttribute("http-equiv") ?? "").trim().toLowerCase() === "refresh",
    ),
  ];
  if (!doomed.length) return html;
  for (const el of doomed) el.remove();
  return full ? document.toString() : document.body.innerHTML;
}

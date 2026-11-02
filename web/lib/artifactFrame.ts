import { ARTIFACT_CSP } from "@shared/artifacts";

const PRIVATE = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
const PASSTHROUGH = [401, 403, 404, 429];
const FRAME_DESTS = new Set(["iframe", "frame", "document"]);

export type Format = "html" | "pdf" | "thumb";

export const formatOf = (req: Request): Format => {
  const f = new URL(req.url).searchParams.get("format");
  return f === "pdf" || f === "thumb" ? f : "html";
};

export const isFramedReport = (req: Request): boolean =>
  formatOf(req) === "html" && FRAME_DESTS.has(req.headers.get("sec-fetch-dest") ?? "");

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function retryAfterOf(res: Response): Promise<number | null> {
  const header = Number(res.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.ceil(header);
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as { retryAfter?: unknown } | null;
  return typeof body?.retryAfter === "number" && body.retryAfter > 0 ? Math.ceil(body.retryAfter) : null;
}

export async function artifactErrorPage(res: Response, href: string): Promise<Response> {
  const status = PASSTHROUGH.includes(res.status) ? res.status : 502;
  let body: string;
  if (status === 404) body = `<p id="report-error-message">This report doesn't exist or isn't yours.</p>`;
  else if (status === 429) {
    const wait = await retryAfterOf(res);
    body = `<p id="report-error-message">Too many requests. Try again in ${wait ?? 60} seconds.</p>`;
  } else
    body = `<p id="report-error-message">This report couldn't be loaded.</p><p id="report-error-retry"><a id="report-error-retry-link" href="${escapeHtml(href)}" target="_self">Try again</a></p>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Report</title><style>body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font:15px/1.5 system-ui,sans-serif;color:#2a2a2a;background:#fff;text-align:center;padding:24px;box-sizing:border-box}a{color:#1f5a63}</style></head><body>${body}</body></html>`;
  return new Response(html, {
    status,
    headers: { ...PRIVATE, "content-type": "text/html; charset=utf-8", "content-security-policy": ARTIFACT_CSP },
  });
}

import { ARTIFACT_CSP, ARTIFACT_ID_RE } from "@shared/artifacts";
import { agentFetch, authFailure, jsonError, unreachableUnlessMisconfigured } from "@/lib/agentServer";
import { type AgentAuth, getAgentAuth } from "@/lib/auth";

const PRIVATE = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
const PASSTHROUGH = [401, 403, 404, 429];
const FRAME_DESTS = new Set(["iframe", "frame", "document"]);

type Format = "html" | "pdf" | "thumb";

const formatOf = (req: Request): Format => {
  const f = new URL(req.url).searchParams.get("format");
  return f === "pdf" || f === "thumb" ? f : "html";
};

const SUFFIX: Record<Format, string> = { html: "", pdf: ".pdf", thumb: ".jpg" };

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

async function errorPage(res: Response, href: string): Promise<Response> {
  const status = PASSTHROUGH.includes(res.status) ? res.status : 502;
  let body: string;
  if (status === 404) body = "<p>This report doesn't exist or isn't yours.</p>";
  else if (status === 429) {
    const wait = await retryAfterOf(res);
    body = `<p>Too many requests. Try again in ${wait ?? 60} seconds.</p>`;
  } else body = `<p>This report couldn't be loaded.</p><p><a href="${escapeHtml(href)}" target="_self">Try again</a></p>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Report</title><style>body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font:15px/1.5 system-ui,sans-serif;color:#2a2a2a;background:#fff;text-align:center;padding:24px;box-sizing:border-box}a{color:#1f5a63}</style></head><body>${body}</body></html>`;
  return new Response(html, {
    status,
    headers: { ...PRIVATE, "content-type": "text/html; charset=utf-8", "content-security-policy": ARTIFACT_CSP },
  });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const format = formatOf(req);
  const framed = format === "html" && FRAME_DESTS.has(req.headers.get("sec-fetch-dest") ?? "");
  const href = `/api/artifacts/${id}`;
  const res = await proxy(id, format);
  return framed && !res.ok ? errorPage(res, href) : res;
}

async function proxy(id: string, format: Format): Promise<Response> {
  if (!ARTIFACT_ID_RE.test(id)) return jsonError(404, "not_found");
  let auth: AgentAuth;
  try {
    auth = await getAgentAuth();
  } catch (e) {
    return authFailure(e);
  }
  let upstream: Response;
  try {
    upstream = await agentFetch(`/artifacts/${id}${SUFFIX[format]}`, auth);
  } catch (e) {
    return unreachableUnlessMisconfigured(e);
  }
  if (!upstream.ok) {
    const retryAfter = upstream.headers.get("retry-after");
    return new Response(upstream.body, {
      status: PASSTHROUGH.includes(upstream.status) ? upstream.status : 502,
      headers: {
        ...PRIVATE,
        "content-type": upstream.headers.get("content-type") ?? "application/json",
        ...(retryAfter && { "retry-after": retryAfter }),
      },
    });
  }
  if (format === "pdf") {
    return new Response(upstream.body, {
      headers: {
        ...PRIVATE,
        "content-type": "application/pdf",
        "content-disposition": upstream.headers.get("content-disposition") ?? `attachment; filename="${id}.pdf"`,
      },
    });
  }
  if (format === "thumb") return new Response(upstream.body, { headers: { ...PRIVATE, "content-type": "image/jpeg" } });
  return new Response(upstream.body, {
    headers: { ...PRIVATE, "content-type": "text/html; charset=utf-8", "content-security-policy": ARTIFACT_CSP },
  });
}

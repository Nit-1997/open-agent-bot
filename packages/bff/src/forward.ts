import type { AuthOutcome, BffContext, BffDeps } from "./types.ts";

export const PRIVATE_NO_STORE = "private, no-store";

const SAFE_METHODS = new Set(["GET", "HEAD"]);

export const isSafeMethod = (method: string): boolean => SAFE_METHODS.has(method);

export function jsonError(status: number, error: string, message?: string): Response {
  return Response.json(message ? { error, message } : { error }, { status, headers: { "cache-control": PRIVATE_NO_STORE } });
}

export const notFound = (): Response => jsonError(404, "not_found", "Not found.");

export const methodNotAllowed = (): Response => jsonError(405, "method_not_allowed", "Method not allowed.");

export const unreachable = (): Response => jsonError(502, "agent_unreachable", "The agent isn't reachable.");

export const refusal = (outcome: Extract<AuthOutcome, { ok: false }>): Response =>
  jsonError(outcome.status, outcome.error, outcome.message);

export function isAllowedOrigin(origin: string | null, rule: BffDeps["appOrigin"]): boolean {
  if (!origin || origin === "null") return false;
  if (typeof rule === "string") return origin === rule;
  if (typeof rule === "function") return rule(origin);
  return rule.includes(origin);
}

export const writeRefused = (req: Request, ctx: BffContext): boolean =>
  !isSafeMethod(req.method) && !isAllowedOrigin(req.headers.get("origin"), ctx.appOrigin);

export const isRedirect = (res: Response): boolean => res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400);

export async function discard(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => {});
}

function concat(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function cappedBody(req: Request, max: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > max || !req.body) return declared > max ? null : "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(concat(chunks, size));
}

export function upstreamHeaders(auth: Readonly<Record<string, string>>, forwarded: Readonly<Record<string, string | null>> = {}): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(forwarded)) if (value) headers.set(name, value);
  for (const [name, value] of Object.entries(auth)) headers.set(name, value);
  return headers;
}

export async function forward(req: Request, path: string, ctx: BffContext): Promise<Response> {
  if (writeRefused(req, ctx)) return jsonError(403, "bad_origin");
  const auth = await ctx.auth(req);
  if (!auth.ok) return refusal(auth);
  const body = isSafeMethod(req.method) ? "" : await cappedBody(req, ctx.maxBodyBytes);
  if (body === null) return jsonError(413, "too_large", "That request is too large.");
  let upstream: Response;
  try {
    upstream = await ctx.fetch(`${ctx.agentUrl}${path}`, {
      method: req.method,
      headers: upstreamHeaders(auth.headers, { "content-type": req.headers.get("content-type") }),
      body: body || undefined,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });
  } catch {
    return unreachable();
  }
  if (isRedirect(upstream)) {
    await discard(upstream);
    return unreachable();
  }
  const headers = new Headers({
    "content-type": upstream.headers.get("content-type") ?? "application/json",
    "cache-control": PRIVATE_NO_STORE,
  });
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter) headers.set("retry-after", retryAfter);
  return new Response(upstream.body, { status: upstream.status, headers });
}

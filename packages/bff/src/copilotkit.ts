import { normalizeId } from "@oab/shared/ids";
import {
  discard,
  isRedirect,
  jsonError,
  methodNotAllowed,
  notFound,
  PRIVATE_NO_STORE,
  refusal,
  unreachable,
  upstreamHeaders,
  writeRefused,
} from "./forward.ts";
import type { BffContext } from "./types.ts";

const AGENT_ID = "openagent";
const FORWARDED = ["content-type", "accept"] as const;

type Allowed = Readonly<{ method: "GET" | "POST"; path: string }>;

function allowlisted(rest: readonly string[]): Allowed | null {
  if (rest.length === 1 && rest[0] === "info") return { method: "GET", path: "info" };
  if (rest[0] !== "agent" || rest[1] !== AGENT_ID) return null;
  const action = rest[2];
  if (rest.length === 3 && (action === "run" || action === "connect")) return { method: "POST", path: `agent/${AGENT_ID}/${action}` };
  if (rest.length === 4 && action === "stop") {
    const threadId = normalizeId(rest[3]);
    return threadId ? { method: "POST", path: `agent/${AGENT_ID}/stop/${encodeURIComponent(threadId)}` } : null;
  }
  return null;
}

function headerTimeout(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("The agent sent no response headers in time.", "TimeoutError")), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

export async function copilotProxy(req: Request, rest: readonly string[], ctx: BffContext): Promise<Response> {
  if (writeRefused(req, ctx)) return jsonError(403, "bad_origin");
  const auth = await ctx.auth(req);
  if (!auth.ok) return refusal(auth);
  const allowed = allowlisted(rest);
  if (!allowed) return notFound();
  if (req.method !== allowed.method) return methodNotAllowed();
  const forwarded = Object.fromEntries(FORWARDED.map((name) => [name, req.headers.get(name)]));
  const hasBody = allowed.method === "POST" && req.body !== null;
  const timeout = headerTimeout(ctx.timeoutMs);
  let upstream: Response;
  try {
    upstream = await ctx.fetch(`${ctx.agentUrl}/copilotkit/${allowed.path}`, {
      method: allowed.method,
      headers: upstreamHeaders(auth.headers, forwarded),
      body: hasBody ? req.body : undefined,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.any([req.signal, timeout.signal]),
      ...(hasBody && { duplex: "half" }),
    } as RequestInit);
  } catch {
    return unreachable();
  } finally {
    timeout.clear();
  }
  if (isRedirect(upstream)) {
    await discard(upstream);
    return unreachable();
  }
  const headers = new Headers({ "cache-control": PRIVATE_NO_STORE });
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  return new Response(upstream.body, { status: upstream.status, headers });
}

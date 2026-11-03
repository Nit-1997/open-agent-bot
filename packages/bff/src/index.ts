import { artifact } from "./artifacts.ts";
import { copilotProxy } from "./copilotkit.ts";
import { forward, jsonError, methodNotAllowed, notFound } from "./forward.ts";
import { segmentsOf } from "./params.ts";
import { allowsMethod, matchRoute } from "./routes.ts";
import type { BffContext, BffDeps, BffHandler } from "./types.ts";

export { artifactErrorPage, isFramedReport } from "./artifacts.ts";
export { isAllowedOrigin, jsonError } from "./forward.ts";
export { localAuth } from "./local.ts";
export { segmentsOf } from "./params.ts";
export type { AuthOutcome, BffDeps, BffHandler } from "./types.ts";

export class BffConfigError extends Error {
  override name = "BffConfigError";
}

const DEFAULTS = { basePath: "/api", timeoutMs: 30_000, maxBodyBytes: 1024 * 1024 };
const BASE_PATH_RE = /^(\/[A-Za-z0-9._~-]+)+$/;

function agentUrlOf(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BffConfigError("agentUrl must be an absolute http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BffConfigError("agentUrl must use http or https");
  if (url.username || url.password) throw new BffConfigError("agentUrl must not carry credentials");
  if (raw.includes("?") || raw.includes("#")) throw new BffConfigError("agentUrl must not have a query or fragment");
  if (raw.endsWith("/")) throw new BffConfigError("agentUrl must not end with a slash");
  return raw;
}

function positive(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new BffConfigError(`${name} must be a positive integer`);
  return value;
}

function hostsOf(hosts: readonly string[] | undefined): ReadonlySet<string> | null {
  if (!hosts) return null;
  if (hosts.some((h) => typeof h !== "string" || h.trim() === "")) throw new BffConfigError("allowedHosts entries must be non-empty");
  return new Set(hosts.map((h) => h.toLowerCase()));
}

function contextOf(deps: BffDeps): BffContext {
  const basePath = deps.basePath ?? DEFAULTS.basePath;
  if (!BASE_PATH_RE.test(basePath)) throw new BffConfigError("basePath must look like /api");
  return {
    agentUrl: agentUrlOf(deps.agentUrl),
    appOrigin: deps.appOrigin,
    allowedHosts: hostsOf(deps.allowedHosts),
    auth: deps.auth,
    fetch: deps.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    basePath,
    timeoutMs: positive("timeoutMs", deps.timeoutMs ?? DEFAULTS.timeoutMs),
    maxBodyBytes: positive("maxBodyBytes", deps.maxBodyBytes ?? DEFAULTS.maxBodyBytes),
  };
}

const misdirected = () => jsonError(421, "misdirected", "This host isn't served here.");

const malformed = () => new Response("Internal Server Error", { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } });

export function createBff(deps: BffDeps): BffHandler {
  const ctx = contextOf(deps);
  return async (req) => {
    if (ctx.allowedHosts && !ctx.allowedHosts.has((req.headers.get("host") ?? "").toLowerCase())) return misdirected();
    const url = new URL(req.url);
    const found = segmentsOf(url.pathname, ctx.basePath);
    if (found.kind === "outside") return notFound();
    if (found.kind === "malformed") return malformed();
    if (found.kind === "redirect") return new Response(null, { status: 308, headers: { location: `${found.location}${url.search}` } });
    const match = matchRoute(found.segments);
    if (!match) return notFound();
    const { route, params } = match;
    if (!allowsMethod(route, req.method)) return methodNotAllowed();
    if (route.kind === "copilot") return copilotProxy(req, params.rest, ctx);
    if (route.kind === "artifact") return artifact(req, params.id, ctx);
    const target = route.toAgent(url, params);
    return target instanceof Response ? target : forward(req, target.path, ctx);
  };
}

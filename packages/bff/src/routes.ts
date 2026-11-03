import { ARTIFACT_ID_RE } from "@oab/shared/artifacts";
import { normalizeId } from "@oab/shared/ids";
import { isSearchScope, normalizeQuery, SEARCH_MAX, SEARCH_MIN, searchOffsetOk } from "@oab/shared/lists";
import { parsePage } from "@oab/shared/pages";
import { jsonError } from "./forward.ts";
import { encodePath, joinSegments } from "./params.ts";

export type RouteParams = Readonly<{ id: string; rest: readonly string[] }>;

export type AgentTarget = Readonly<{ path: string }>;

type ToAgent = (url: URL, params: RouteParams) => AgentTarget | Response;

export type Route = Readonly<
  | { pattern: readonly string[]; methods: readonly string[]; kind: "forward"; toAgent: ToAgent }
  | { pattern: readonly string[]; methods: readonly string[]; kind: "artifact" }
  | { pattern: readonly string[]; methods: readonly string[]; kind: "copilot" }
>;

const ID = ":id";
const REST = "*";

const PROVIDERS_ALLOWED = /^(local|test|logins\/[0-9a-f-]{36}(\/answer)?|[a-z0-9-]+(\/(key|models|login))?)?$/;
const SETTINGS_ALLOWED = /^(brave-search(\/key)?)?$/;

const badPage = () => jsonError(400, "invalid", "That page number isn't valid.");

function paged(prefix: string): ToAgent {
  return (url) => {
    const page = parsePage(url.searchParams.get("page"));
    return page === null ? badPage() : { path: `${prefix}?page=${page}` };
  };
}

function chat(suffix: string): ToAgent {
  return (_url, { id }) => {
    const chatId = normalizeId(id);
    return chatId ? { path: `/chats/${encodeURIComponent(chatId)}${suffix}` } : jsonError(404, "not_found", "This chat doesn't exist.");
  };
}

function report(_url: URL, { id }: RouteParams): AgentTarget | Response {
  return ARTIFACT_ID_RE.test(id)
    ? { path: `/reports/${encodeURIComponent(id)}` }
    : jsonError(404, "not_found", "That report doesn't exist.");
}

function search(url: URL): AgentTarget | Response {
  const params = url.searchParams;
  const q = normalizeQuery(params.get("q") ?? "");
  if (!q) return jsonError(400, "invalid", `Search for ${SEARCH_MIN} to ${SEARCH_MAX} characters.`);
  const scope = params.get("scope") || "all";
  if (!isSearchScope(scope)) return jsonError(400, "invalid", "scope must be all, chats or reports");
  const page = parsePage(params.get("page"));
  if (page === null || !searchOffsetOk(page)) return badPage();
  return { path: `/search?q=${encodeURIComponent(q)}&scope=${scope}&page=${page}` };
}

function onboardingOptions(url: URL): AgentTarget {
  const params = new URLSearchParams();
  for (const key of ["lat", "lon", "country"]) {
    const value = url.searchParams.get(key);
    if (value) params.set(key, value.slice(0, 20));
  }
  return { path: `/onboarding/options?${params}` };
}

function places(url: URL): AgentTarget {
  const q = url.searchParams.get("q") ?? "";
  return { path: `/places?q=${encodeURIComponent(q.slice(0, 200))}` };
}

function subpath(prefix: string, allowed: RegExp): ToAgent {
  return (_url, { rest }) => {
    const sub = joinSegments(rest);
    if (!allowed.test(sub)) return Response.json({ error: "not found" }, { status: 404 });
    return { path: `${prefix}${sub ? `/${encodePath(sub)}` : ""}` };
  };
}

const fixed =
  (path: string): ToAgent =>
  () => ({ path });

export const ROUTES: readonly Route[] = [
  { pattern: ["chats"], methods: ["GET"], kind: "forward", toAgent: paged("/chats") },
  { pattern: ["chats", ID], methods: ["GET"], kind: "forward", toAgent: chat("") },
  { pattern: ["chats", ID, "messages"], methods: ["GET"], kind: "forward", toAgent: chat("/messages") },
  { pattern: ["reports"], methods: ["GET"], kind: "forward", toAgent: paged("/reports") },
  { pattern: ["reports", ID], methods: ["GET"], kind: "forward", toAgent: report },
  { pattern: ["search"], methods: ["GET"], kind: "forward", toAgent: search },
  { pattern: ["models"], methods: ["GET"], kind: "forward", toAgent: fixed("/models") },
  { pattern: ["onboarding", "options"], methods: ["GET"], kind: "forward", toAgent: onboardingOptions },
  { pattern: ["places"], methods: ["GET"], kind: "forward", toAgent: places },
  { pattern: ["profile"], methods: ["GET", "PUT"], kind: "forward", toAgent: fixed("/profile") },
  {
    pattern: ["providers", REST],
    methods: ["DELETE", "GET", "POST", "PUT"],
    kind: "forward",
    toAgent: subpath("/providers", PROVIDERS_ALLOWED),
  },
  { pattern: ["settings", REST], methods: ["DELETE", "GET", "POST"], kind: "forward", toAgent: subpath("/settings", SETTINGS_ALLOWED) },
  { pattern: ["artifacts", ID], methods: ["GET"], kind: "artifact" },
  { pattern: ["copilotkit", REST], methods: ["DELETE", "GET", "PATCH", "POST"], kind: "copilot" },
];

export type RouteMatch = Readonly<{ route: Route; params: RouteParams }>;

function matchOne(route: Route, segments: readonly string[]): RouteParams | null {
  const catchAll = route.pattern.at(-1) === REST;
  const fixedLength = catchAll ? route.pattern.length - 1 : route.pattern.length;
  if (catchAll ? segments.length < fixedLength : segments.length !== fixedLength) return null;
  let id = "";
  for (let i = 0; i < fixedLength; i += 1) {
    const part = route.pattern[i];
    if (part === ID) id = segments[i];
    else if (part !== segments[i]) return null;
  }
  return { id, rest: catchAll ? segments.slice(fixedLength) : [] };
}

export function matchRoute(segments: readonly string[]): RouteMatch | null {
  for (const route of ROUTES) {
    const params = matchOne(route, segments);
    if (params) return { route, params };
  }
  return null;
}

export const allowsMethod = (route: Route, method: string): boolean =>
  route.methods.includes(method) || (method === "HEAD" && route.methods.includes("GET"));

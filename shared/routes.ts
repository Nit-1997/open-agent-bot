import { ARTIFACT_ID_RE } from "./artifacts.ts";
import { normalizeId } from "./ids.ts";
import { isSearchScope, normalizeQuery, type SearchScope } from "./lists.ts";
import { parsePage } from "./pages.ts";
import { type EntityKind, entityIdFromKey, isEntityKind } from "./workspace.ts";

export type Route =
  | { section: "chat"; chatId: string | null; report: string | null }
  | { section: "chats"; page: number }
  | { section: "reports"; page: number }
  | { section: "report"; id: string }
  | { section: "plans"; page: number; kind: EntityKind | null }
  | { section: "plan"; chatId: string; kind: EntityKind; key: string; entityId: string }
  | { section: "search"; q: string | null; scope: SearchScope; page: number }
  | { section: "admin" };

export type Section = Route["section"];

type Params = { get(name: string): string | null };

const pageOf = (params: Params) => parsePage(params.get("page")) ?? 1;

export function parseRoute(pathname: string, params: Params = new URLSearchParams()): Route | null {
  const parts = pathname.split("/").slice(1);
  if (parts.length > 1 && parts.at(-1) === "") parts.pop();
  const [head, a, b, c, ...rest] = parts;
  if (rest.length) return null;
  switch (head) {
    case "":
      return parts.length === 1 ? { section: "chat", chatId: null, report: null } : null;
    case "admin":
      return parts.length === 1 ? { section: "admin" } : null;
    case "chats": {
      if (a === undefined) return { section: "chats", page: pageOf(params) };
      const chatId = normalizeId(a);
      if (!chatId || b !== undefined) return null;
      const report = params.get("report");
      return { section: "chat", chatId, report: report !== null && ARTIFACT_ID_RE.test(report) ? report : null };
    }
    case "reports": {
      if (a === undefined) return { section: "reports", page: pageOf(params) };
      return ARTIFACT_ID_RE.test(a) && b === undefined ? { section: "report", id: a } : null;
    }
    case "plans": {
      if (a === undefined) {
        const kind = params.get("kind");
        return { section: "plans", page: pageOf(params), kind: isEntityKind(kind) ? kind : null };
      }
      const chatId = normalizeId(a);
      const entityId = c === undefined ? undefined : entityIdFromKey(c);
      if (!chatId || !isEntityKind(b) || entityId === undefined) return null;
      return { section: "plan", chatId, kind: b, key: c as string, entityId };
    }
    case "search": {
      if (a !== undefined) return null;
      const scope = params.get("scope");
      return { section: "search", q: normalizeQuery(params.get("q") ?? ""), scope: isSearchScope(scope) ? scope : "all", page: pageOf(params) };
    }
    default:
      return null;
  }
}

function withQuery(path: string, query: Record<string, string | number | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== null && v !== undefined && v !== "") params.set(k, String(v));
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

const pageParam = (page: number) => (page > 1 ? page : null);

export function hrefFor(route: Route): string {
  switch (route.section) {
    case "chat":
      return route.chatId ? withQuery(`/chats/${route.chatId}`, { report: route.report }) : "/";
    case "chats":
      return withQuery("/chats", { page: pageParam(route.page) });
    case "reports":
      return withQuery("/reports", { page: pageParam(route.page) });
    case "report":
      return `/reports/${route.id}`;
    case "plans":
      return withQuery("/plans", { kind: route.kind, page: pageParam(route.page) });
    case "plan":
      return `/plans/${route.chatId}/${route.kind}/${route.key}`;
    case "search":
      return withQuery("/search", { q: route.q, scope: route.scope === "all" ? null : route.scope, page: pageParam(route.page) });
    case "admin":
      return "/admin";
  }
}

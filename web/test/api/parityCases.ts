export const MAX_BODY = 1024 * 1024;
export const CHAT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const REPORT = "AbCdEf_-1234";
export const LOGIN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const EVIL_ORIGIN = "https://evil.test";

export type RouteKey =
  | "chats"
  | "chats/[id]"
  | "chats/[id]/messages"
  | "reports"
  | "reports/[id]"
  | "search"
  | "models"
  | "onboarding/options"
  | "places"
  | "profile"
  | "providers/[[...path]]"
  | "settings/[[...path]]"
  | "artifacts/[id]"
  | "copilotkit/[[...slug]]";

export type AuthMode = "ok" | "signed_out" | "auth_unavailable" | "config_error";

export type BodySpec = { kind: "none" } | { kind: "json"; text: string } | { kind: "declared_over" } | { kind: "streamed_over" };

export type Reply = { kind: "network" } | { kind: "http"; status: number; headers: Record<string, string>; body: string };

export type ParityInput = {
  route: RouteKey;
  method: string;
  url: string;
  params: Record<string, string | string[]>;
  origin: string | null;
  secFetchDest: string | null;
  body: BodySpec;
  auth: AuthMode;
  reply: Reply;
};

export type ParityCase = { name: string; input: ParityInput };

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export const EXPORTED: Record<RouteKey, readonly string[]> = {
  chats: ["GET"],
  "chats/[id]": ["GET"],
  "chats/[id]/messages": ["GET"],
  reports: ["GET"],
  "reports/[id]": ["GET"],
  search: ["GET"],
  models: ["GET"],
  "onboarding/options": ["GET"],
  places: ["GET"],
  profile: ["GET", "PUT"],
  "providers/[[...path]]": ["DELETE", "GET", "POST", "PUT"],
  "settings/[[...path]]": ["DELETE", "GET", "POST"],
  "artifacts/[id]": ["GET"],
  "copilotkit/[[...slug]]": ["DELETE", "GET", "PATCH", "POST"],
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Reply => ({
  kind: "http",
  status,
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

const OK_JSON = json(200, { ok: true }, { "set-cookie": "agent=1", "x-foo": "bar", "cache-control": "public, max-age=60" });
const OK_HTML: Reply = { kind: "http", status: 200, headers: { "content-type": "text/html" }, body: "<h1>Report</h1>" };
const OK_PDF: Reply = {
  kind: "http",
  status: 200,
  headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="plan.pdf"' },
  body: "%PDF-1.7 parity",
};
const OK_PDF_NO_DISPOSITION: Reply = { kind: "http", status: 200, headers: { "content-type": "application/pdf" }, body: "%PDF-1.7 parity" };
const OK_JPEG: Reply = { kind: "http", status: 200, headers: { "content-type": "image/jpeg" }, body: "ÿØjpeg" };

const FAILURES: ReadonlyArray<readonly [string, Reply]> = [
  ["upstream 401", json(401, { error: "signed_out", message: "You were signed out. Sign in again." })],
  ["upstream 403", json(403, { error: "access_disabled", message: "Access is turned off for this account." })],
  ["upstream 404", json(404, { error: "not_found", message: "Not found." })],
  ["upstream 429", json(429, { error: "rate_limited", retryAfter: 7 }, { "retry-after": "7" })],
  ["upstream 429 body only", json(429, { error: "rate_limited", retryAfter: 42 })],
  ["upstream 500", { kind: "http", status: 500, headers: { "content-type": "text/plain" }, body: "boom" }],
  ["network error", { kind: "network" }],
];

const SAFE = new Set(["GET", "HEAD"]);

type Base = Omit<ParityInput, "origin" | "secFetchDest" | "body" | "auth" | "reply"> &
  Partial<Pick<ParityInput, "origin" | "secFetchDest" | "body" | "reply">>;

function input(base: Base): ParityInput {
  return {
    origin: SAFE.has(base.method) ? null : "APP",
    secFetchDest: null,
    body: { kind: "none" },
    auth: "ok",
    reply: OK_JSON,
    ...base,
  };
}

const one = (name: string, base: Base, extra: Partial<ParityInput> = {}): ParityCase => ({ name, input: { ...input(base), ...extra } });

function standard(name: string, base: Base, ok: Reply = OK_JSON): ParityCase[] {
  const valid = input({ ...base, reply: ok });
  const cases: ParityCase[] = [
    { name: `${name} valid`, input: valid },
    { name: `${name} signed out`, input: { ...valid, auth: "signed_out" } },
    { name: `${name} auth unavailable`, input: { ...valid, auth: "auth_unavailable" } },
    { name: `${name} config error`, input: { ...valid, auth: "config_error" } },
    ...FAILURES.map(([label, reply]) => ({ name: `${name} ${label}`, input: { ...valid, reply } })),
  ];
  if (!SAFE.has(base.method))
    cases.push(
      { name: `${name} cross-origin`, input: { ...valid, origin: EVIL_ORIGIN } },
      { name: `${name} no origin`, input: { ...valid, origin: null } },
      { name: `${name} null origin`, input: { ...valid, origin: "null" } },
      { name: `${name} declared body over 1 MiB`, input: { ...valid, body: { kind: "declared_over" } } },
      { name: `${name} streamed body over 1 MiB`, input: { ...valid, body: { kind: "streamed_over" } } },
    );
  return cases;
}

const body = (value: unknown): BodySpec => ({ kind: "json", text: JSON.stringify(value) });

function forwardRoutes(): ParityCase[] {
  return [
    ...standard("chats GET", { route: "chats", method: "GET", url: "/api/chats?page=2", params: {} }),
    one("chats GET no page", { route: "chats", method: "GET", url: "/api/chats", params: {} }),
    one("chats GET page 0", { route: "chats", method: "GET", url: "/api/chats?page=0", params: {} }),
    one("chats GET page abc", { route: "chats", method: "GET", url: "/api/chats?page=abc", params: {} }),
    one("chats GET page -1", { route: "chats", method: "GET", url: "/api/chats?page=-1", params: {} }),
    one("chats GET page too large", { route: "chats", method: "GET", url: "/api/chats?page=100001", params: {} }),

    ...standard("chat GET", { route: "chats/[id]", method: "GET", url: `/api/chats/${CHAT}`, params: { id: CHAT } }),
    one("chat GET not a uuid", { route: "chats/[id]", method: "GET", url: "/api/chats/not-a-uuid", params: { id: "not-a-uuid" } }),
    one("chat GET uppercase uuid", {
      route: "chats/[id]",
      method: "GET",
      url: `/api/chats/${CHAT.toUpperCase()}`,
      params: { id: CHAT.toUpperCase() },
    }),
    one("chat GET percent-encoded uuid", {
      route: "chats/[id]",
      method: "GET",
      url: `/api/chats/%41${CHAT.slice(1)}`,
      params: { id: `A${CHAT.slice(1)}` },
    }),
    one("chat GET encoded slash", {
      route: "chats/[id]",
      method: "GET",
      url: `/api/chats/${CHAT.slice(0, 8)}%2F${CHAT.slice(9)}`,
      params: { id: `${CHAT.slice(0, 8)}/${CHAT.slice(9)}` },
    }),
    one("chat GET double-encoded slash", {
      route: "chats/[id]",
      method: "GET",
      url: `/api/chats/${CHAT.slice(0, 8)}%252F${CHAT.slice(9)}`,
      params: { id: `${CHAT.slice(0, 8)}%2F${CHAT.slice(9)}` },
    }),

    ...standard("chat messages GET", {
      route: "chats/[id]/messages",
      method: "GET",
      url: `/api/chats/${CHAT}/messages`,
      params: { id: CHAT },
    }),
    one("chat messages GET not a uuid", {
      route: "chats/[id]/messages",
      method: "GET",
      url: "/api/chats/nope/messages",
      params: { id: "nope" },
    }),
    one("chat messages GET uppercase uuid", {
      route: "chats/[id]/messages",
      method: "GET",
      url: `/api/chats/${CHAT.toUpperCase()}/messages`,
      params: { id: CHAT.toUpperCase() },
    }),

    ...standard("reports GET", { route: "reports", method: "GET", url: "/api/reports?page=3", params: {} }),
    one("reports GET no page", { route: "reports", method: "GET", url: "/api/reports", params: {} }),
    one("reports GET page 0", { route: "reports", method: "GET", url: "/api/reports?page=0", params: {} }),
    one("reports GET page x", { route: "reports", method: "GET", url: "/api/reports?page=x", params: {} }),

    ...standard("report GET", { route: "reports/[id]", method: "GET", url: `/api/reports/${REPORT}`, params: { id: REPORT } }),
    one("report GET short id", { route: "reports/[id]", method: "GET", url: "/api/reports/short", params: { id: "short" } }),
    one("report GET uppercase id", {
      route: "reports/[id]",
      method: "GET",
      url: "/api/reports/E2EREPORT001",
      params: { id: "E2EREPORT001" },
    }),
    one("report GET percent-encoded id", {
      route: "reports/[id]",
      method: "GET",
      url: "/api/reports/%412eReport001",
      params: { id: "A2eReport001" },
    }),
    one("report GET encoded traversal", {
      route: "reports/[id]",
      method: "GET",
      url: "/api/reports/..%2F..%2Fetc",
      params: { id: "../../etc" },
    }),
    one("report GET encoded slash", {
      route: "reports/[id]",
      method: "GET",
      url: "/api/reports/e2eRepor%2F001",
      params: { id: "e2eRepor/001" },
    }),

    ...standard("search GET", { route: "search", method: "GET", url: "/api/search?q=big%20sur&scope=chats&page=2", params: {} }),
    one("search GET defaults", { route: "search", method: "GET", url: "/api/search?q=big%20sur", params: {} }),
    one("search GET normalizes the query", {
      route: "search",
      method: "GET",
      url: "/api/search?q=%20big%20%20sur/%3F%23&scope=reports",
      params: {},
    }),
    one("search GET missing q", { route: "search", method: "GET", url: "/api/search", params: {} }),
    one("search GET one character", { route: "search", method: "GET", url: "/api/search?q=a", params: {} }),
    one("search GET two characters", { route: "search", method: "GET", url: "/api/search?q=ab", params: {} }),
    one("search GET over 100 characters", { route: "search", method: "GET", url: `/api/search?q=${"a".repeat(101)}`, params: {} }),
    one("search GET bad scope", { route: "search", method: "GET", url: "/api/search?q=abc&scope=plans", params: {} }),
    one("search GET empty scope", { route: "search", method: "GET", url: "/api/search?q=abc&scope=", params: {} }),
    one("search GET bad page", { route: "search", method: "GET", url: "/api/search?q=abc&page=0", params: {} }),
    one("search GET offset past the limit", { route: "search", method: "GET", url: "/api/search?q=abc&page=1002", params: {} }),
    one("search GET last allowed page", { route: "search", method: "GET", url: "/api/search?q=abc&page=1001", params: {} }),

    ...standard("models GET", { route: "models", method: "GET", url: "/api/models", params: {} }),
    one("models GET ignores the query", { route: "models", method: "GET", url: "/api/models?x=1", params: {} }),

    ...standard("onboarding options GET", {
      route: "onboarding/options",
      method: "GET",
      url: "/api/onboarding/options?lat=12.3&lon=45.6&country=NZ",
      params: {},
    }),
    one("onboarding options GET no params", { route: "onboarding/options", method: "GET", url: "/api/onboarding/options", params: {} }),
    one("onboarding options GET drops unknown and cuts long values", {
      route: "onboarding/options",
      method: "GET",
      url: `/api/onboarding/options?lat=${"1".repeat(30)}&evil=1&country=${encodeURIComponent("New Zealand & more stuff")}`,
      params: {},
    }),

    ...standard("places GET", { route: "places", method: "GET", url: "/api/places?q=wellington", params: {} }),
    one("places GET missing q", { route: "places", method: "GET", url: "/api/places", params: {} }),
    one("places GET cuts q to 200", { route: "places", method: "GET", url: `/api/places?q=${"w".repeat(250)}`, params: {} }),
    one("places GET encodes q", { route: "places", method: "GET", url: "/api/places?q=a%26b%3Dc%2Fd", params: {} }),

    ...standard("profile GET", { route: "profile", method: "GET", url: "/api/profile", params: {} }),
    ...standard("profile PUT", {
      route: "profile",
      method: "PUT",
      url: "/api/profile",
      params: {},
      body: body({ profile: { name: "Ada" } }),
    }),
    one("profile PUT empty body", { route: "profile", method: "PUT", url: "/api/profile", params: {} }),
  ];
}

function catchAll(route: "providers/[[...path]]" | "settings/[[...path]]", sub: string, rawSub = sub) {
  const prefix = route === "providers/[[...path]]" ? "providers" : "settings";
  return {
    route,
    url: `/api/${prefix}${rawSub ? `/${rawSub}` : ""}`,
    params: (sub ? { path: rawSub.split("/").map(decodeURIComponent) } : {}) as Record<string, string | string[]>,
  };
}

function subpathRoutes(): ParityCase[] {
  const P = "providers/[[...path]]" as const;
  const S = "settings/[[...path]]" as const;
  return [
    ...standard("providers GET", { ...catchAll(P, ""), method: "GET" }),
    ...standard("providers POST key", { ...catchAll(P, "openrouter/key"), method: "POST", body: body({ key: "sk-test" }) }),
    ...standard("providers PUT models", { ...catchAll(P, "openrouter/models"), method: "PUT", body: body({ models: ["a"] }) }),
    ...standard("providers DELETE key", { ...catchAll(P, "openrouter/key"), method: "DELETE" }),
    one("providers GET local", { ...catchAll(P, "local"), method: "GET" }),
    one("providers GET test", { ...catchAll(P, "test"), method: "GET" }),
    one("providers POST login", { ...catchAll(P, "openai/login"), method: "POST", body: body({}) }),
    one("providers GET login status", { ...catchAll(P, `logins/${LOGIN}`), method: "GET" }),
    one("providers POST login answer", { ...catchAll(P, `logins/${LOGIN}/answer`), method: "POST", body: body({ code: "1" }) }),
    one("providers GET uppercase", { ...catchAll(P, "OPENAI"), method: "GET" }),
    one("providers GET too deep", { ...catchAll(P, "a/b/c"), method: "GET" }),
    one("providers GET unknown action", { ...catchAll(P, "openai/secret"), method: "GET" }),
    one("providers GET encoded slash joins", { ...catchAll(P, "openai/key", "openai%2Fkey"), method: "GET" }),
    one("providers GET encoded letter", { ...catchAll(P, "openai", "%6Fpenai"), method: "GET" }),
    one("providers GET bad login id", { ...catchAll(P, "logins/nope/answer"), method: "GET" }),
    one("providers DELETE cross-origin bad path", { ...catchAll(P, "a/b/c"), method: "DELETE", origin: EVIL_ORIGIN }),

    ...standard("settings GET", { ...catchAll(S, "brave-search"), method: "GET" }),
    ...standard("settings POST key", { ...catchAll(S, "brave-search/key"), method: "POST", body: body({ key: "bsk" }) }),
    ...standard("settings DELETE key", { ...catchAll(S, "brave-search/key"), method: "DELETE" }),
    one("settings GET root", { ...catchAll(S, ""), method: "GET" }),
    one("settings GET unknown", { ...catchAll(S, "other"), method: "GET" }),
    one("settings GET uppercase", { ...catchAll(S, "BRAVE-SEARCH"), method: "GET" }),
    one("settings GET encoded slash joins", { ...catchAll(S, "brave-search/key", "brave-search%2Fkey"), method: "GET" }),
    one("settings GET openai key", { ...catchAll(S, "openai/key", "openai%2Fkey"), method: "GET" }),
    one("settings POST unknown cross-origin", { ...catchAll(S, "other"), method: "POST", origin: EVIL_ORIGIN }),
  ];
}

function artifactRoutes(): ParityCase[] {
  const formats: ReadonlyArray<readonly [string, string, Reply]> = [
    ["html", "", OK_HTML],
    ["pdf", "?format=pdf", OK_PDF],
    ["thumb", "?format=thumb", OK_JPEG],
  ];
  const cases: ParityCase[] = [];
  for (const [format, qs, ok] of formats)
    for (const dest of [null, "iframe"] as const) {
      const label = `artifact ${format}${dest ? " framed" : ""}`;
      cases.push(
        ...standard(
          label,
          {
            route: "artifacts/[id]",
            method: "GET",
            url: `/api/artifacts/${REPORT}${qs}`,
            params: { id: REPORT },
            secFetchDest: dest,
          },
          ok,
        ),
        one(`${label} bad id`, {
          route: "artifacts/[id]",
          method: "GET",
          url: `/api/artifacts/short${qs}`,
          params: { id: "short" },
          secFetchDest: dest,
        }),
      );
    }
  return [
    ...cases,
    one("artifact pdf without disposition", {
      route: "artifacts/[id]",
      method: "GET",
      url: `/api/artifacts/${REPORT}?format=pdf`,
      params: { id: REPORT },
      reply: OK_PDF_NO_DISPOSITION,
    }),
    one("artifact unknown format is html", {
      route: "artifacts/[id]",
      method: "GET",
      url: `/api/artifacts/${REPORT}?format=docx`,
      params: { id: REPORT },
      reply: OK_HTML,
    }),
    one(
      "artifact html document navigation 404",
      { route: "artifacts/[id]", method: "GET", url: `/api/artifacts/${REPORT}`, params: { id: REPORT }, secFetchDest: "document" },
      { reply: FAILURES[2][1] },
    ),
    one(
      "artifact pdf framed 404 stays json",
      {
        route: "artifacts/[id]",
        method: "GET",
        url: `/api/artifacts/${REPORT}?format=pdf`,
        params: { id: REPORT },
        secFetchDest: "iframe",
      },
      { reply: FAILURES[2][1] },
    ),
    one("artifact encoded traversal", {
      route: "artifacts/[id]",
      method: "GET",
      url: "/api/artifacts/..%2F..%2Fetc",
      params: { id: "../../etc" },
      secFetchDest: "iframe",
    }),
  ];
}

function copilotRefusals(): ParityCase[] {
  const C = "copilotkit/[[...slug]]" as const;
  const run = {
    route: C,
    method: "POST",
    url: "/api/copilotkit/agent/openagent/run",
    params: { slug: ["agent", "openagent", "run"] },
    body: body({ threadId: CHAT, runId: "r1", messages: [] }),
  };
  const info = { route: C, method: "GET", url: "/api/copilotkit/info", params: { slug: ["info"] } };
  return [
    one("copilotkit run cross-origin", run, { origin: EVIL_ORIGIN }),
    one("copilotkit run no origin", run, { origin: null }),
    one("copilotkit run null origin", run, { origin: "null" }),
    one("copilotkit stop cross-origin", {
      route: C,
      method: "POST",
      url: `/api/copilotkit/agent/openagent/stop/${CHAT}`,
      params: { slug: ["agent", "openagent", "stop", CHAT] },
      origin: EVIL_ORIGIN,
    }),
    one("copilotkit PATCH cross-origin", {
      route: C,
      method: "PATCH",
      url: "/api/copilotkit/info",
      params: { slug: ["info"] },
      origin: EVIL_ORIGIN,
    }),
    one("copilotkit DELETE no origin", {
      route: C,
      method: "DELETE",
      url: "/api/copilotkit/info",
      params: { slug: ["info"] },
      origin: null,
    }),
    one("copilotkit run signed out", run, { auth: "signed_out" }),
    one("copilotkit info signed out", info, { auth: "signed_out" }),
    one("copilotkit run auth unavailable", run, { auth: "auth_unavailable" }),
    one("copilotkit info auth unavailable", info, { auth: "auth_unavailable" }),
    one("copilotkit run config error", run, { auth: "config_error" }),
    one("copilotkit info config error", info, { auth: "config_error" }),
  ];
}

const BASE_URL: Record<RouteKey, { url: string; params: Record<string, string | string[]> }> = {
  chats: { url: "/api/chats", params: {} },
  "chats/[id]": { url: `/api/chats/${CHAT}`, params: { id: CHAT } },
  "chats/[id]/messages": { url: `/api/chats/${CHAT}/messages`, params: { id: CHAT } },
  reports: { url: "/api/reports", params: {} },
  "reports/[id]": { url: `/api/reports/${REPORT}`, params: { id: REPORT } },
  search: { url: "/api/search?q=abc", params: {} },
  models: { url: "/api/models", params: {} },
  "onboarding/options": { url: "/api/onboarding/options", params: {} },
  places: { url: "/api/places?q=x", params: {} },
  profile: { url: "/api/profile", params: {} },
  "providers/[[...path]]": { url: "/api/providers/openrouter/key", params: { path: ["openrouter", "key"] } },
  "settings/[[...path]]": { url: "/api/settings/brave-search/key", params: { path: ["brave-search", "key"] } },
  "artifacts/[id]": { url: `/api/artifacts/${REPORT}`, params: { id: REPORT } },
  "copilotkit/[[...slug]]": { url: "/api/copilotkit/info", params: { slug: ["info"] } },
};

function notExported(): ParityCase[] {
  return (Object.keys(EXPORTED) as RouteKey[]).flatMap((route) =>
    METHODS.filter((m) => !EXPORTED[route].includes(m)).map((method) =>
      one(`${route} ${method} not exported`, { route, method, ...BASE_URL[route], origin: "APP" }),
    ),
  );
}

export function parityCases(): ParityCase[] {
  return [...forwardRoutes(), ...subpathRoutes(), ...artifactRoutes(), ...copilotRefusals(), ...notExported()];
}

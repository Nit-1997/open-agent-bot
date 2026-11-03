import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AuthError } from "../src/hosted/identity/verify.js";
import { NO_CAPABILITIES, type Principal } from "../src/identity/types.js";
import { makeApp, tokenFor } from "./fixtures/app.js";
import { TEST_SECRET } from "./fixtures/config.js";
import { ADMIN, ALICE, ALL_CAPABILITIES, BOB, CHAT_1, verified } from "./fixtures/users.js";

const MATRIX_FILE = join(import.meta.dirname, "fixtures/route-matrix.json");
const HEADERS = ["content-type", "cache-control", "content-security-policy", "x-content-type-options", "content-disposition"] as const;

const principal = (n: number, name: string, isAdmin: boolean): Principal => ({
  id: `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`,
  email: `${name}@example.test`,
  capabilities: isAdmin ? ALL_CAPABILITIES : NO_CAPABILITIES,
});

const DEACTIVATED = principal(4, "deactivated", false);
const STATUS_THROWS = principal(5, "status-throws", false);
const ADMIN_NOT_LIVE = principal(6, "admin-not-live", true);
const ADMIN_LIVE_THROWS = principal(7, "admin-live-throws", true);
const KNOWN = [ALICE, BOB, ADMIN, DEACTIVATED, STATUS_THROWS, ADMIN_NOT_LIVE, ADMIN_LIVE_THROWS];
const FAILING_TOKENS = { "t.jwks-down": "auth_unavailable", "t.expired": "expired_token", "t.invalid": "invalid_token" } as const;

type Caller = { name: string; secret: string | null; bearer?: string };

const CALLERS: Caller[] = [
  { name: "NO_SECRET", secret: null, bearer: tokenFor(ALICE) },
  { name: "SECRET_NO_BEARER", secret: TEST_SECRET },
  { name: "WRONG_SECRET", secret: `${TEST_SECRET.slice(1)}b`, bearer: tokenFor(ALICE) },
  { name: "ALICE", secret: TEST_SECRET, bearer: tokenFor(ALICE) },
  { name: "BOB", secret: TEST_SECRET, bearer: tokenFor(BOB) },
  { name: "ADMIN", secret: TEST_SECRET, bearer: tokenFor(ADMIN) },
  { name: "DEACTIVATED", secret: TEST_SECRET, bearer: tokenFor(DEACTIVATED) },
  { name: "STATUS_THROWS", secret: TEST_SECRET, bearer: tokenFor(STATUS_THROWS) },
  { name: "JWKS_DOWN", secret: TEST_SECRET, bearer: "t.jwks-down" },
  { name: "EXPIRED", secret: TEST_SECRET, bearer: "t.expired" },
  { name: "INVALID", secret: TEST_SECRET, bearer: "t.invalid" },
  { name: "ADMIN_NOT_LIVE", secret: TEST_SECRET, bearer: tokenFor(ADMIN_NOT_LIVE) },
  { name: "ADMIN_LIVE_THROWS", secret: TEST_SECRET, bearer: tokenFor(ADMIN_LIVE_THROWS) },
];

type Probe = { route: string; method: string; path: string; body?: object };

const ID = "99999999-9999-4999-8999-999999999999";
const ROUTES: Probe[] = [
  { route: "/health", method: "GET", path: "/health" },
  {
    route: "/access-requests",
    method: "POST",
    path: "/access-requests",
    body: { name: "A", email: "a@example.test", note: "", formToken: "" },
  },
  { route: "/auth/email-link", method: "POST", path: "/auth/email-link", body: { email: "a@example.test" } },
  { route: "/agui", method: "POST", path: "/agui", body: { threadId: CHAT_1, runId: "run-1", messages: [] } },
  { route: "/chats", method: "GET", path: "/chats" },
  { route: "/chats/:id", method: "GET", path: `/chats/${CHAT_1}` },
  { route: "/chats/:id/messages", method: "GET", path: `/chats/${CHAT_1}/messages` },
  { route: "/reports", method: "GET", path: "/reports" },
  { route: "/reports/:id", method: "GET", path: `/reports/${ID}` },
  { route: "/search", method: "GET", path: "/search?q=hello" },
  { route: "/profile", method: "GET", path: "/profile" },
  { route: "/profile", method: "PUT", path: "/profile", body: {} },
  { route: "/settings", method: "GET", path: "/settings" },
  { route: "/settings/brave-search/key", method: "POST", path: "/settings/brave-search/key", body: { apiKey: "" } },
  { route: "/settings/brave-search", method: "DELETE", path: "/settings/brave-search" },
  { route: "/places", method: "GET", path: "/places?q=paris" },
  { route: "/onboarding/options", method: "GET", path: "/onboarding/options" },
  { route: "/models", method: "GET", path: "/models" },
  { route: "/providers", method: "GET", path: "/providers" },
  { route: "/providers/local", method: "POST", path: "/providers/local", body: { kind: "", baseUrl: "" } },
  { route: "/providers/test", method: "POST", path: "/providers/test", body: { model: "" } },
  { route: "/providers/logins/:flow", method: "GET", path: "/providers/logins/flow-1" },
  { route: "/providers/logins/:flow/answer", method: "POST", path: "/providers/logins/flow-1/answer", body: { value: "" } },
  { route: "/providers/logins/:flow", method: "DELETE", path: "/providers/logins/flow-1" },
  { route: "/providers/:id/login", method: "POST", path: "/providers/openrouter/login", body: {} },
  { route: "/providers/:id/key", method: "POST", path: "/providers/openrouter/key", body: { apiKey: "" } },
  { route: "/providers/:id", method: "DELETE", path: "/providers/openrouter" },
  { route: "/providers/:id/models", method: "GET", path: "/providers/openrouter/models" },
  { route: "/providers/:id/models", method: "PUT", path: "/providers/openrouter/models", body: { enabled: [] } },
  { route: "/artifacts/:file", method: "GET", path: `/artifacts/${ID}.pdf` },
  { route: "/admin/access-requests", method: "GET", path: "/admin/access-requests" },
  { route: "/admin/access-requests/:id/approve", method: "POST", path: `/admin/access-requests/${ID}/approve`, body: {} },
  { route: "/admin/access-requests/:id/reject", method: "POST", path: `/admin/access-requests/${ID}/reject`, body: {} },
  { route: "/admin/access-requests/:id/resend", method: "POST", path: `/admin/access-requests/${ID}/resend`, body: {} },
  { route: "/admin/users", method: "GET", path: "/admin/users" },
  { route: "/admin/users/:id/deactivate", method: "POST", path: `/admin/users/${BOB.id}/deactivate`, body: {} },
  { route: "/admin/users/:id/reactivate", method: "POST", path: `/admin/users/${BOB.id}/reactivate`, body: {} },
  { route: "/admin/users/:id", method: "DELETE", path: `/admin/users/${BOB.id}`, body: { confirmEmail: BOB.email } },
];

const EXTRAS: Probe[] = [
  { route: "", method: "GET", path: "/admin" },
  { route: "", method: "GET", path: "/admin/" },
  { route: "", method: "GET", path: "/admin/nope" },
  { route: "", method: "OPTIONS", path: "/chats" },
  { route: "", method: "GET", path: "/no-such-path" },
];

const PROBES = [...ROUTES, ...EXTRAS];

type Cell = { status: number; error: string | null } & Record<(typeof HEADERS)[number], string | null>;
type Matrix = { callers: string[]; headers: string[]; routes: string[]; cells: Record<string, Record<string, Cell>> };
type Delta = { path: string; caller: string; before: Cell; after: Cell };

const EXPECTED_DELTAS: Delta[] = [];

const USER_PATHS = [
  "/agui",
  "/chats",
  "/chats/*",
  "/profile",
  "/settings",
  "/settings/*",
  "/places",
  "/onboarding/*",
  "/models",
  "/providers",
  "/providers/*",
  "/artifacts/*",
  "/reports",
  "/reports/*",
  "/search",
];

const key = (p: Probe) => `${p.method} ${p.path}`;
const bare = (path: string) => path.split("?")[0]!;
const onUserPath = (path: string) => USER_PATHS.some((u) => (u.endsWith("/*") ? bare(path).startsWith(u.slice(0, -1)) : bare(path) === u));

async function harnessFor() {
  const tokens = new Map(KNOWN.map((u) => [tokenFor(u), u]));
  const live = new Map<string, () => Promise<boolean>>([
    [ADMIN_NOT_LIVE.id, async () => false],
    [ADMIN_LIVE_THROWS.id, async () => Promise.reject(new Error("auth admin down"))],
  ]);
  const h = await makeApp({
    seams: {
      verify: async (token) => {
        const failure = FAILING_TOKENS[token as keyof typeof FAILING_TOKENS];
        if (failure) throw new AuthError(failure);
        const u = tokens.get(token);
        if (!u) throw new AuthError("invalid_token");
        return verified(u);
      },
      statusOf: async (id) => {
        if (id === STATUS_THROWS.id) throw new Error("status lookup down");
        if (id === DEACTIVATED.id) return "deactivated";
        return KNOWN.some((u) => u.id === id) ? "active" : undefined;
      },
      isLiveAdmin: async (u) => (live.get(u.id) ?? (async () => u.capabilities.admin))(),
    },
  });
  for (const u of [DEACTIVATED, STATUS_THROWS, ADMIN_NOT_LIVE, ADMIN_LIVE_THROWS]) h.accounts.add(u);
  return h;
}

async function cellFor(app: Awaited<ReturnType<typeof makeApp>>["app"], caller: Caller, probe: Probe): Promise<Cell> {
  const res = await app.request(probe.path, {
    method: probe.method,
    headers: {
      "content-type": "application/json",
      ...(caller.secret !== null && { "x-agent-secret": caller.secret }),
      ...(caller.bearer && { authorization: `Bearer ${caller.bearer}` }),
    },
    ...(probe.body && { body: JSON.stringify(probe.body) }),
  });
  const type = res.headers.get("content-type");
  let error: string | null = null;
  if (type?.includes("application/json")) {
    const json = (await res.json()) as { error?: unknown };
    error = typeof json.error === "string" ? json.error : null;
  } else await res.body?.cancel();
  const headers = Object.fromEntries(HEADERS.map((h) => [h, res.headers.get(h)])) as Record<(typeof HEADERS)[number], string | null>;
  return { status: res.status, error, ...headers };
}

async function runMatrix(): Promise<{ matrix: Matrix; routes: string[] }> {
  const quiet = [vi.spyOn(console, "warn").mockImplementation(() => {}), vi.spyOn(console, "error").mockImplementation(() => {})];
  const cells: Matrix["cells"] = {};
  let routes: string[] = [];
  try {
    for (const caller of CALLERS) {
      const h = await harnessFor();
      routes = [...new Set(h.app.routes.filter((r) => r.method !== "ALL").map((r) => `${r.method} ${r.path}`))].sort();
      for (const probe of PROBES) {
        cells[key(probe)] ??= {};
        cells[key(probe)]![caller.name] = await cellFor(h.app, caller, probe);
      }
      await h.queue.idle();
    }
  } finally {
    for (const q of quiet) q.mockRestore();
  }
  return { matrix: { callers: CALLERS.map((c) => c.name), headers: [...HEADERS], routes, cells }, routes };
}

const isRefusal = (status: number) => [401, 403, 404, 503].includes(status);

describe("route, guard and header matrix", async () => {
  const { matrix: actual, routes } = await runMatrix();
  if (process.env.UPDATE_ROUTE_MATRIX === "1") {
    writeFileSync(MATRIX_FILE, `${JSON.stringify(actual, null, 2)}\n`);
  }
  const recorded = JSON.parse(readFileSync(MATRIX_FILE, "utf8")) as Matrix;
  const adminBase = ["/admin", "/admin/"].filter((p) => recorded.cells[`GET ${p}`]?.SECRET_NO_BEARER?.status === 401);
  const guardedAdmin = (path: string) => bare(path).startsWith("/admin/") || adminBase.includes(path);
  const guarded = (path: string) => onUserPath(path) || guardedAdmin(path);
  const cell = (p: Probe, caller: string) => actual.cells[key(p)]![caller]!;

  it("covers 13 callers, 5 headers, every route of the app and the bare admin paths", () => {
    expect(recorded.callers).toHaveLength(13);
    expect(recorded.headers).toEqual([...HEADERS]);
    expect(actual.callers).toEqual(recorded.callers);
    expect(routes).toEqual(recorded.routes);
    expect(new Set(ROUTES.map((p) => `${p.method} ${p.route}`))).toEqual(new Set(recorded.routes.filter((r) => !r.startsWith("OPTIONS "))));
    expect(Object.keys(recorded.cells)).toEqual(expect.arrayContaining(["GET /admin", "GET /admin/", "GET /admin/nope"]));
  });

  it("matches the recorded matrix apart from the listed deltas", () => {
    const deltas: Delta[] = [];
    for (const [k, row] of Object.entries(recorded.cells)) {
      for (const [caller, before] of Object.entries(row)) {
        const after = actual.cells[k]?.[caller];
        if (JSON.stringify(after) !== JSON.stringify(before)) deltas.push({ path: k.split(" ")[1]!, caller, before, after: after! });
      }
    }
    expect(deltas).toEqual(EXPECTED_DELTAS);
  });

  it("lists only bare admin paths as deltas and every delta is a refusal", () => {
    for (const d of EXPECTED_DELTAS) {
      expect(["/admin", "/admin/"]).toContain(d.path);
      expect(isRefusal(d.after.status)).toBe(true);
    }
  });

  it("never answers 500", () => {
    for (const p of PROBES) for (const c of CALLERS) expect(cell(p, c.name).status, `${key(p)} ${c.name}`).not.toBe(500);
  });

  it("refuses callers without the right service secret everywhere except /health and OPTIONS", () => {
    for (const p of PROBES.filter((x) => x.path !== "/health" && x.method !== "OPTIONS")) {
      for (const name of ["NO_SECRET", "WRONG_SECRET"]) {
        expect(cell(p, name), `${key(p)} ${name}`).toMatchObject({ status: 401, error: "unauthorized" });
      }
    }
  });

  it("answers OPTIONS with 405 before the secret check", () => {
    for (const c of CALLERS) expect(cell({ route: "", method: "OPTIONS", path: "/chats" }, c.name).status).toBe(405);
  });

  const refusals: Array<[string, string[], number, string, (path: string) => boolean]> = [
    ["deactivated users", ["DEACTIVATED"], 403, "account_disabled", guarded],
    ["unavailable status or keys", ["STATUS_THROWS", "JWKS_DOWN"], 503, "auth_unavailable", guarded],
    ["missing, expired or invalid tokens", ["EXPIRED", "INVALID", "SECRET_NO_BEARER"], 401, "signed_out", guarded],
    ["non-admins and admins without live status", ["ALICE", "BOB", "ADMIN_NOT_LIVE"], 404, "not_found", guardedAdmin],
    ["admins whose live check throws", ["ADMIN_LIVE_THROWS"], 503, "auth_unavailable", guardedAdmin],
  ];

  it.each(refusals)("refuses %s on the paths their guard covers", (_name, callers, status, error, inScope) => {
    const scoped = PROBES.filter((p) => inScope(p.path) && p.method !== "OPTIONS");
    expect(scoped.length).toBeGreaterThan(0);
    for (const p of scoped) {
      for (const name of callers) {
        const got = cell(p, name);
        expect(got, `${key(p)} ${name}`).toMatchObject({ status, error });
        expect(got.status).not.toBeLessThan(300);
      }
    }
  });

  it("lets the admin through on admin routes", () => {
    expect(cell({ route: "", method: "GET", path: "/admin/users" }, "ADMIN").status).toBe(200);
    expect(cell({ route: "", method: "GET", path: "/admin/access-requests" }, "ADMIN").status).toBe(200);
  });
});

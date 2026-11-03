// @vitest-environment node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthUnavailable, getAgentAuth, SignedOut } from "@/lib/auth";
import { AUTH_ERROR_COPY } from "@/lib/authErrors";
import { ConfigError } from "@/lib/env";
import { AGENT_URL, APP_ORIGIN, AUTH, SERVICE_SECRET, stubAgentEnv } from "../support/agentEnv";
import { type AuthMode, EXPORTED, parityCases, type RouteKey } from "./parityCases";
import { type Driver, type Env, type ParityRow, recordingFetch, runCase, type UpstreamCall } from "./parityHarness";

vi.mock("@/lib/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth")>()), getAgentAuth: vi.fn() }));

const ENV: Env = { appOrigin: APP_ORIGIN, agentUrl: AGENT_URL, secret: SERVICE_SECRET, accessToken: AUTH.accessToken };
const PARITY_PATH = new URL("../fixtures/route-parity.json", import.meta.url);
const PROXY_PATH = new URL("../fixtures/copilot-proxy.json", import.meta.url);
const UPDATE = process.env.UPDATE_PARITY === "1";

type Handler = (req: Request, ctx: { params: Promise<Record<string, string | string[]>> }) => Promise<Response>;
type RouteModule = Record<string, unknown>;

const LOADERS: Record<RouteKey, () => Promise<RouteModule>> = {
  chats: () => import("@/app/api/chats/route"),
  "chats/[id]": () => import("@/app/api/chats/[id]/route"),
  "chats/[id]/messages": () => import("@/app/api/chats/[id]/messages/route"),
  reports: () => import("@/app/api/reports/route"),
  "reports/[id]": () => import("@/app/api/reports/[id]/route"),
  search: () => import("@/app/api/search/route"),
  models: () => import("@/app/api/models/route"),
  "onboarding/options": () => import("@/app/api/onboarding/options/route"),
  places: () => import("@/app/api/places/route"),
  profile: () => import("@/app/api/profile/route"),
  "providers/[[...path]]": () => import("@/app/api/providers/[[...path]]/route"),
  "settings/[[...path]]": () => import("@/app/api/settings/[[...path]]/route"),
  "artifacts/[id]": () => import("@/app/api/artifacts/[id]/route"),
  "copilotkit/[[...slug]]": () => import("@/app/api/copilotkit/[[...slug]]/route"),
};

const modules = new Map<RouteKey, RouteModule>();
let currentFetch: typeof fetch = () => Promise.reject(new Error("no fetch installed"));

function setAgentAuth(mode: AuthMode): void {
  const auth = vi.mocked(getAgentAuth);
  if (mode === "ok") auth.mockResolvedValue(AUTH);
  else if (mode === "signed_out") auth.mockRejectedValue(new SignedOut("signed_out"));
  else if (mode === "auth_unavailable") auth.mockRejectedValue(new AuthUnavailable("auth_unavailable"));
  else auth.mockRejectedValue(new ConfigError("AGENT_SERVICE_SECRET is not set"));
}

const install = (f: typeof fetch) => {
  currentFetch = f;
  vi.stubGlobal("fetch", f);
};

const nextDriver: Driver = {
  exports: (input) => typeof modules.get(input.route)?.[input.method] === "function",
  call: (input, req) => {
    setAgentAuth(input.auth);
    const handler = modules.get(input.route)?.[input.method] as Handler;
    return handler(req, { params: Promise.resolve(input.params) });
  },
};

type Bff = typeof import("@oab/bff");
let bff: Bff | undefined;

const authOutcome = (mode: AuthMode) => async () => {
  if (mode === "ok")
    return { ok: true as const, headers: { "x-agent-secret": SERVICE_SECRET, authorization: `Bearer ${AUTH.accessToken}` } };
  if (mode === "signed_out")
    return { ok: false as const, status: 401 as const, error: "signed_out" as const, message: AUTH_ERROR_COPY.signed_out };
  if (mode === "auth_unavailable")
    return { ok: false as const, status: 503 as const, error: "auth_unavailable" as const, message: AUTH_ERROR_COPY.auth_unavailable };
  throw new ConfigError("AGENT_SERVICE_SECRET is not set");
};

function directBff(mode: AuthMode) {
  if (!bff) throw new Error("@oab/bff is not available");
  return bff.createBff({ agentUrl: AGENT_URL, appOrigin: APP_ORIGIN, auth: authOutcome(mode), fetch: (i, init) => currentFetch(i, init) });
}

const directDriver: Driver = {
  exports: () => true,
  call: (input, req) => directBff(input.auth)(req),
};

beforeAll(async () => {
  for (const [key, load] of Object.entries(LOADERS) as Array<[RouteKey, () => Promise<RouteModule>]>) modules.set(key, await load());
  bff = await import("@oab/bff").catch(() => undefined);
});

beforeEach(stubAgentEnv);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.mocked(getAgentAuth).mockReset();
});

const CASES = parityCases();

describe.runIf(UPDATE)("route parity fixture (UPDATE_PARITY=1)", () => {
  it("records every case from the current Next route modules", { timeout: 120000 }, async () => {
    const rows: ParityRow[] = [];
    for (const c of CASES) rows.push(await runCase(nextDriver, c, ENV, install));
    writeFileSync(
      PARITY_PATH,
      `${JSON.stringify({ note: "Generated from the pre-refactor Next routes (PR 2.3b commit 1). Never edit.", rows }, null, 2)}\n`,
    );
  });
});

const fixture = (): ParityRow[] =>
  existsSync(PARITY_PATH) ? (JSON.parse(readFileSync(PARITY_PATH, "utf8")) as { rows: ParityRow[] }).rows : [];
const ROWS = UPDATE ? [] : fixture();

describe.skipIf(UPDATE)("route parity", () => {
  it("covers every route and every method each route exports, with no unexpected 500", () => {
    expect(ROWS.map((r) => r.name)).toEqual(CASES.map((c) => c.name));
    for (const [route, methods] of Object.entries(EXPORTED))
      for (const method of methods)
        expect(
          ROWS.some((r) => r.input.route === route && r.input.method === method && r.outcome.kind === "response"),
          `${route} ${method}`,
        ).toBe(true);
    const fiveHundreds = ROWS.filter((r) => r.outcome.kind === "response" && r.outcome.status === 500 && r.input.reply.kind !== "http");
    expect(fiveHundreds.map((r) => r.name)).toEqual([]);
    expect(ROWS.filter((r) => r.input.route === "copilotkit/[[...slug]]" && r.upstream.length > 0)).toEqual([]);
  });

  describe("through the Next route modules", () => {
    it.each(ROWS.map((r) => [r.name, r] as const))("%s", async (_name, row) => {
      expect(await runCase(nextDriver, { name: row.name, input: row.input }, ENV, install)).toEqual(row);
    });
  });

  describe("through createBff directly", () => {
    it.each(ROWS.map((r) => [r.name, r] as const))("%s", async (_name, row) => {
      const got = await runCase(directDriver, { name: row.name, input: row.input }, ENV, install);
      if (row.outcome.kind !== "next405") return expect(got).toEqual(row);
      expect(got.upstream).toEqual([]);
      expect(got.outcome).toMatchObject({ kind: "response", status: 405 });
      expect(got.outcome.kind === "response" && JSON.parse(got.outcome.body)).toMatchObject({ error: "method_not_allowed" });
    });
  });

  describe("standalone rows through createBff", () => {
    const unknown = ["/api/nope", "/api/chats/a/b/c", "/api/reports/x/y", "/api/copilotkitx/info", "/api/profile/extra", "/api"];
    it.each(unknown)("%s answers 404 not_found without calling the agent", async (path) => {
      const recorder = recordingFetch(ENV, () => Response.json({}));
      install(recorder.fetch as typeof fetch);
      const res = await directBff("ok")(new Request(`${APP_ORIGIN}${path}`));
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: "not_found" });
      expect(recorder.calls).toEqual([]);
    });
  });
});

type ProxyRow = {
  name: string;
  request: { method: string; url: string; headers: Record<string, string>; body: string | null };
  reply: null | { network: true } | { status: number; headers: Record<string, string>; chunks: string[] };
  expect: {
    status: number;
    headerNames: string[];
    headers: Record<string, string>;
    body: string;
    reads?: number;
    upstream: UpstreamCall[];
  };
};

const PROXY_ROWS = (JSON.parse(readFileSync(PROXY_PATH, "utf8")) as { rows: ProxyRow[] }).rows;

function chunked(chunks: string[]): ReadableStream<Uint8Array> {
  const queue = chunks.map((c) => new TextEncoder().encode(c));
  return new ReadableStream({
    async pull(controller) {
      await new Promise((r) => setTimeout(r, 5));
      const next = queue.shift();
      if (next) controller.enqueue(next);
      else controller.close();
    },
  });
}

function upstreamReply(row: ProxyRow): Response {
  const reply = row.reply;
  if (!reply) return Response.json({ unexpected: true });
  if ("network" in reply) throw new TypeError("fetch failed");
  return new Response(chunked(reply.chunks), { status: reply.status, headers: reply.headers });
}

function proxyRequest(row: ProxyRow): Request {
  const headers = new Headers(row.request.headers);
  if (headers.get("origin") === "APP") headers.set("origin", APP_ORIGIN);
  return new Request(`${APP_ORIGIN}${row.request.url}`, { method: row.request.method, headers, body: row.request.body ?? undefined });
}

async function readAll(res: Response): Promise<{ body: string; reads: number }> {
  if (!res.body) return { body: "", reads: 0 };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let reads = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    reads += 1;
    body += decoder.decode(value, { stream: true });
  }
  return { body, reads };
}

const slugOf = (url: string) => new URL(url, APP_ORIGIN).pathname.split("/").slice(3).filter(Boolean).map(decodeURIComponent);

const proxyDrivers: ReadonlyArray<readonly [string, (req: Request) => Promise<Response>]> = [
  [
    "Next route module",
    (req) => {
      setAgentAuth("ok");
      const handler = modules.get("copilotkit/[[...slug]]")?.[req.method] as Handler;
      return handler(req, { params: Promise.resolve({ slug: slugOf(req.url) }) });
    },
  ],
  ["createBff", (req) => directBff("ok")(req)],
];

describe.skipIf(UPDATE)("copilot proxy (hand-written intended behaviour)", () => {
  describe.each(proxyDrivers)("through the %s", (_label, call) => {
    it.each(PROXY_ROWS.map((r) => [r.name, r] as const))("%s", async (_name, row) => {
      const recorder = recordingFetch(ENV, () => upstreamReply(row));
      install(recorder.fetch as typeof fetch);
      const res = await call(proxyRequest(row));
      const { body, reads } = await readAll(res);
      expect(res.status).toBe(row.expect.status);
      expect([...res.headers.keys()].sort()).toEqual(row.expect.headerNames);
      for (const [name, value] of Object.entries(row.expect.headers)) expect(res.headers.get(name), name).toBe(value);
      expect(body).toBe(row.expect.body);
      if (row.expect.reads !== undefined) expect(reads).toBe(row.expect.reads);
      expect(recorder.calls).toEqual(row.expect.upstream);
    });
  });
});

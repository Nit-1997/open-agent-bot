import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBff, localAuth } from "@oab/bff";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { localHosts, localOrigins } from "../../src/local/hosts.js";
import { createLocalFront, PAGE_CSP } from "../../src/local/front.js";
import { StartupRefusal } from "../../src/local/refusal.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

const P = 18330;
const APP = `http://127.0.0.1:${P}`;
const SECRET = "0123456789abcdef".repeat(4);
const REPORT = "AbCdEf_12-34";
const INDEX =
  '<!doctype html><html><head><script type="module" src="/assets/index-Ab12Cd34.js"></script></head><body><div id="root"></div></body></html>';
const OUTSIDE = "outside-the-ui-build";

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'";

let root: string;
let uiDir: string;
let agentCalls: string[];
const lines: string[] = [];

function agentFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  agentCalls.push(`${init?.method ?? "GET"} ${url.pathname}`);
  if (url.pathname === `/artifacts/${REPORT}`)
    return Promise.resolve(new Response("<p id='r'>report</p>", { headers: { "content-type": "text/html" } }));
  return Promise.resolve(Response.json({ items: [] }));
}

const bff = createBff({
  agentUrl: "http://core.internal",
  appOrigin: localOrigins(P),
  allowedHosts: localHosts(P),
  auth: localAuth({ secret: SECRET }),
  fetch: agentFetch as typeof fetch,
});

let front: ReturnType<typeof createLocalFront>;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "oa-front-")));
  uiDir = join(root, "dist");
  mkdirSync(join(uiDir, "assets"), { recursive: true });
  writeFileSync(join(uiDir, "index.html"), INDEX);
  writeFileSync(join(uiDir, "assets", "index-Ab12Cd34.js"), "console.log('app')");
  writeFileSync(join(uiDir, "assets", "index-Ef56Gh78.css"), "body{}");
  writeFileSync(join(uiDir, "assets", "inter-latin.woff2"), "font");
  writeFileSync(join(root, "package.json"), OUTSIDE);
  writeFileSync(join(root, "secret.txt"), OUTSIDE);
  symlinkSync(join(root, "secret.txt"), join(uiDir, "linked.txt"));
  symlinkSync(root, join(uiDir, "assets", "up"));
  front = createLocalFront({ uiDir, port: P, bff, log: (line) => lines.push(line) });
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

beforeEach(() => {
  agentCalls = [];
  lines.length = 0;
  vi.mocked(fsp.readFile).mockClear();
});

function call(path: string, init: { method?: string; host?: string; headers?: Record<string, string>; body?: string } = {}) {
  const headers = new Headers({ host: init.host ?? `127.0.0.1:${P}`, ...init.headers });
  return front.request(`${APP}${path}`, { method: init.method ?? "GET", headers, body: init.body });
}

const corsHeaders = (res: Response) => [...res.headers.keys()].filter((k) => k.startsWith("access-control-"));

describe("pages", () => {
  it.each(["/", "/chats", `/chats/0b7c3f5e-3a52-4f8b-9a6e-8f1c2d3e4f50`, "/reports", `/reports/${REPORT}`, "/search?q=x", "/chats/"])(
    "GET %s → index.html, 200, no-store",
    async (path) => {
      const res = await call(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.text()).toBe(INDEX);
    },
  );

  it.each(["/admin", "/nope/deeper", "/reports/short", "/chats/not-a-uuid", "/index.htm", "/linked.txt"])(
    "GET %s → index.html with 404",
    async (path) => {
      const res = await call(path);
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.text()).toBe(INDEX);
    },
  );

  it("answers HEAD like GET without a body", async () => {
    const res = await call("/chats", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it.each(["POST", "PUT", "DELETE", "PATCH", "OPTIONS"])("%s / → 405", async (method) => {
    const res = await call("/", { method });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });

  it("sets the page headers exactly", async () => {
    const res = await call("/");
    expect(PAGE_CSP).toBe(CSP);
    expect(res.headers.get("content-security-policy")).toBe(CSP);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(res.headers.get("strict-transport-security")).toBeNull();
  });
});

describe("static files", () => {
  it("serves hashed assets with the immutable cache header", async () => {
    const res = await call("/assets/index-Ab12Cd34.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe("console.log('app')");
  });

  it.each([
    ["/assets/index-Ef56Gh78.css", "text/css; charset=utf-8"],
    ["/assets/inter-latin.woff2", "font/woff2"],
  ])("serves %s as %s", async (path, type) => {
    const res = await call(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(type);
  });

  it.each([
    "/assets/../package.json",
    "/%2e%2e/package.json",
    "/%2e%2e/etc/passwd",
    "/assets/%2e%2e/%2e%2e/secret.txt",
    "/assets/..%2f..%2fsecret.txt",
    "/assets/up/secret.txt",
    "/linked.txt",
    "/assets/missing.js",
    "//etc/passwd",
  ])("GET %s → 404 and nothing outside the manifest is read", async (path) => {
    const res = await call(path);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(OUTSIDE);
    expect(vi.mocked(fsp.readFile)).not.toHaveBeenCalled();
  });

  it("reads only files listed in the manifest", async () => {
    await call("/assets/index-Ab12Cd34.js");
    const read = vi.mocked(fsp.readFile).mock.calls.map((c) => String(c[0]));
    expect(read).toEqual([join(uiDir, "assets", "index-Ab12Cd34.js")]);
  });
});

describe("the bff behind the front", () => {
  it("passes /api to the bff with its own artifact headers and no front frame header", async () => {
    const res = await call(`/api/artifacts/${REPORT}`, { headers: { "sec-fetch-site": "same-origin" } });
    expect(res.status).toBe(200);
    expect(agentCalls).toEqual([`GET /artifacts/${REPORT}`]);
    expect(res.headers.get("x-frame-options")).toBeNull();
    expect(res.headers.get("content-security-policy")).not.toBe(CSP);
    expect(res.headers.get("content-security-policy")).toBeTruthy();
  });

  it("serves /api/chats through the bff", async () => {
    const res = await call("/api/chats", { headers: { "sec-fetch-site": "same-origin" } });
    expect(res.status).toBe(200);
    expect(agentCalls).toEqual(["GET /chats"]);
  });

  it("serves /api itself through the bff", async () => {
    const res = await call("/api");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

describe("refusals", () => {
  it.each(["/", "/chats", "/assets/index-Ab12Cd34.js", "/api/chats"])("wrong Host on %s → 421", async (path) => {
    for (const host of ["evil.example", `evil.example:${P}`, "127.0.0.1:3000", `localhost:${P + 1}`]) {
      const res = await call(path, { host });
      expect(res.status, host).toBe(421);
    }
    expect(agentCalls).toEqual([]);
  });

  it("answers /health with any Host, no-store, and logs nothing for it", async () => {
    for (const host of ["127.0.0.1:3000", "evil.example", `127.0.0.1:${P}`]) {
      const res = await call("/health", { host });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(lines).toEqual([]);
  });

  it("logs one line per request it serves", async () => {
    await call("/chats");
    await call("/api/chats?q=hidden", { headers: { "sec-fetch-site": "same-origin" } });
    expect(lines.map((l) => l.replace(/\d+ms$/, "Nms"))).toEqual(["[http] GET /chats 200 Nms", "[http] GET /api/chats 200 Nms"]);
  });
});

describe("no CORS", () => {
  it.each<[string, string, Record<string, string>]>([
    ["OPTIONS", "/", { origin: "http://evil.example", "access-control-request-method": "GET" }],
    ["OPTIONS", "/api/chats", { origin: "http://evil.example", "access-control-request-method": "GET" }],
    ["GET", "/api/chats", { origin: "http://evil.example" }],
    ["GET", "/", { origin: "http://evil.example" }],
    ["GET", "/assets/index-Ab12Cd34.js", { origin: "http://evil.example" }],
  ])("%s %s with a foreign Origin carries no Access-Control-* header", async (method, path, headers) => {
    const res = await call(path, { method, headers });
    expect(corsHeaders(res)).toEqual([]);
  });
});

describe("startup", () => {
  it("refuses a UI directory without index.html", () => {
    const empty = mkdtempSync(join(tmpdir(), "oa-front-empty-"));
    try {
      let thrown: unknown;
      try {
        createLocalFront({ uiDir: empty, port: P, bff });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(StartupRefusal);
      expect(thrown).toMatchObject({ code: "ui_missing", message: `UI build not found at ${empty}` });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("refuses a missing UI directory", () => {
    expect(() => createLocalFront({ uiDir: join(root, "nowhere"), port: P, bff })).toThrow(/UI build not found/);
  });
});

import type { AuthOutcome, BffDeps } from "../src/index.ts";

export const AGENT = "http://agent.test:8000";
export const APP = "https://app.test";
export const SECRET = "s".repeat(64);
export const TOKEN = "user-access-token";
export const CHAT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

export const AUTH_HEADERS = { "x-agent-secret": SECRET, authorization: `Bearer ${TOKEN}` };

export const signedIn = async (): Promise<AuthOutcome> => ({ ok: true, headers: AUTH_HEADERS });

export type Seen = {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
  signal: AbortSignal | null;
  redirect: string | undefined;
};

export function fakeAgent(reply: (seen: Seen) => Response | Promise<Response> = () => Response.json({ ok: true })) {
  const seen: Seen[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = init?.body;
    const entry: Seen = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: body === undefined || body === null ? null : typeof body === "string" ? body : await new Response(body).text(),
      signal: init?.signal ?? null,
      redirect: init?.redirect,
    };
    seen.push(entry);
    return reply(entry);
  };
  return { fetch: fetch as typeof globalThis.fetch, seen };
}

export function deps(overrides: Partial<BffDeps> = {}): BffDeps {
  return { agentUrl: AGENT, appOrigin: APP, auth: signedIn, ...overrides };
}

export function request(path: string, init: RequestInit & { origin?: string | null; host?: string | null } = {}): Request {
  const { origin, host, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (origin) headers.set("origin", origin);
  if (host) headers.set("host", host);
  return new Request(`${APP}${path}`, { ...rest, headers });
}

export const localAuth =
  (secret: string) =>
  async (req: Request): Promise<AuthOutcome> => {
    const site = req.headers.get("sec-fetch-site");
    const unsafe = !["GET", "HEAD"].includes(req.method);
    if (unsafe && site !== null && site !== "same-origin")
      return { ok: false, status: 401, error: "signed_out", message: "Cross-site requests are not allowed." };
    return { ok: true, headers: { "x-agent-secret": secret } };
  };

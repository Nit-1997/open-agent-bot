import { createHash } from "node:crypto";
import { MAX_BODY, type ParityCase, type ParityInput, type Reply } from "./parityCases";

export type UpstreamCall = { method: string; path: string; headerNames: string[]; auth: boolean; body: string | null };

export type Outcome =
  | { kind: "next405" }
  | { kind: "throws"; error: string }
  | { kind: "response"; status: number; headers: Record<string, string>; body: string };

export type ParityRow = { name: string; input: ParityInput; bodySize: number; outcome: Outcome; upstream: UpstreamCall[] };

export type Env = { appOrigin: string; agentUrl: string; secret: string; accessToken: string };

const RECORDED_HEADERS = [
  "content-type",
  "cache-control",
  "content-security-policy",
  "x-content-type-options",
  "content-disposition",
  "retry-after",
];
const BINARY = /^(application\/pdf|image\/)/;
const STREAM_CHUNK = 64 * 1024;

function overBodyStream(): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent > MAX_BODY) return controller.close();
      const chunk = new Uint8Array(STREAM_CHUNK).fill(120);
      sent += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
}

export function bodySizeOf(input: ParityInput): number {
  switch (input.body.kind) {
    case "none":
      return 0;
    case "json":
      return new TextEncoder().encode(input.body.text).byteLength;
    case "declared_over":
      return MAX_BODY + 1;
    case "streamed_over":
      return Math.ceil((MAX_BODY + 1) / STREAM_CHUNK) * STREAM_CHUNK;
  }
}

export function requestOf(input: ParityInput, env: Env): Request {
  const headers = new Headers({ cookie: "sb-access=browser-cookie", authorization: "Bearer browser-token", "x-agent-secret": "browser" });
  const origin = input.origin === "APP" ? env.appOrigin : input.origin;
  if (origin !== null) headers.set("origin", origin);
  if (input.secFetchDest) headers.set("sec-fetch-dest", input.secFetchDest);
  const init: RequestInit & { duplex?: "half" } = { method: input.method, headers };
  if (input.body.kind === "json") {
    headers.set("content-type", "application/json");
    init.body = input.body.text;
  } else if (input.body.kind === "declared_over") {
    headers.set("content-type", "application/json");
    headers.set("content-length", String(MAX_BODY + 1));
    init.body = "{}";
  } else if (input.body.kind === "streamed_over") {
    headers.set("content-type", "application/json");
    init.body = overBodyStream();
    init.duplex = "half";
  }
  return new Request(`${env.appOrigin}${input.url}`, init);
}

async function bodyText(body: unknown): Promise<string | null> {
  if (body === undefined || body === null) return null;
  if (typeof body === "string") return body;
  if (body instanceof ReadableStream || body instanceof Uint8Array || body instanceof ArrayBuffer) return new Response(body).text();
  return String(body);
}

export function replyOf(reply: Reply): Response {
  if (reply.kind === "network") throw new TypeError("fetch failed");
  return new Response(reply.body, { status: reply.status, headers: reply.headers });
}

export function recordingFetch(env: Env, reply: (call: UpstreamCall) => Response) {
  const calls: UpstreamCall[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : null;
    const url = request ? request.url : String(input);
    const headers = new Headers(init?.headers ?? request?.headers);
    const call: UpstreamCall = {
      method: init?.method ?? request?.method ?? "GET",
      path: url.startsWith(env.agentUrl) ? url.slice(env.agentUrl.length) : `EXTERNAL ${url}`,
      headerNames: [...headers.keys()].sort(),
      auth: headers.get("x-agent-secret") === env.secret && headers.get("authorization") === `Bearer ${env.accessToken}`,
      body: await bodyText(init?.body ?? (request?.body ? await request.text() : null)),
    };
    calls.push(call);
    return reply(call);
  };
  return { fetch, calls };
}

async function responseBody(res: Response): Promise<string> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (BINARY.test(res.headers.get("content-type") ?? "")) return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  return new TextDecoder().decode(bytes);
}

export async function outcomeOf(run: () => Promise<Response>): Promise<Outcome> {
  let res: Response;
  try {
    res = await run();
  } catch (e) {
    return { kind: "throws", error: e instanceof Error ? e.name : String(e) };
  }
  const headers: Record<string, string> = {};
  for (const name of RECORDED_HEADERS) {
    const value = res.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  return { kind: "response", status: res.status, headers, body: await responseBody(res) };
}

export type Driver = {
  exports(input: ParityInput): boolean;
  call(input: ParityInput, req: Request): Promise<Response>;
};

export async function runCase(
  driver: Driver,
  c: ParityCase,
  env: Env,
  install: (fetch: typeof globalThis.fetch) => void,
): Promise<ParityRow> {
  const recorder = recordingFetch(env, () => replyOf(c.input.reply));
  install(recorder.fetch as typeof globalThis.fetch);
  const base = { name: c.name, input: c.input, bodySize: bodySizeOf(c.input) };
  if (!driver.exports(c.input)) return { ...base, outcome: { kind: "next405" }, upstream: [] };
  const outcome = await outcomeOf(() => driver.call(c.input, requestOf(c.input, env)));
  return { ...base, outcome, upstream: recorder.calls };
}

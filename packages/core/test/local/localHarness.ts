import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const P = 18330;
export const APP = `http://127.0.0.1:${P}`;
export const UI_INDEX = '<!doctype html><html><head></head><body><div id="root"></div></body></html>';

export type LocalRoot = { root: string; data: string; keys: string; renderer: string; ui: string; dispose(): void };

export function localRoot(): LocalRoot {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oa-local-")));
  const dirs = { data: join(root, "data"), keys: join(root, "keys"), renderer: join(root, "renderer"), ui: join(root, "ui") };
  mkdirSync(dirs.ui);
  writeFileSync(join(dirs.ui, "index.html"), UI_INDEX);
  return { root, ...dirs, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

export function localEnv(r: LocalRoot, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    COPILOTKIT_TELEMETRY_DISABLED: "true",
    LOG_LEVEL: "info",
    OPEN_AGENT_DATA_DIR: r.data,
    OPEN_AGENT_KEYS_DIR: r.keys,
    OPEN_AGENT_RENDERER_DIR: r.renderer,
    OPEN_AGENT_UI_DIR: r.ui,
    OPEN_AGENT_PORT: String(P),
    OPEN_AGENT_LISTEN_HOST: "127.0.0.1",
    OPEN_AGENT_LISTEN_PORT: "0",
    SEARXNG_URL: "http://127.0.0.1:9",
    RENDERER_URL: "http://127.0.0.1:9",
    ...extra,
  };
}

export type Reply = { status: number; headers: IncomingMessage["headers"]; text: string };

export type CallInit = { method?: string; host?: string; headers?: Record<string, string>; body?: unknown };

const sameOrigin = (method: string): Record<string, string> =>
  method === "GET" || method === "HEAD" ? { "sec-fetch-site": "same-origin" } : { "sec-fetch-site": "same-origin", origin: APP };

function open(port: number, path: string, init: CallInit = {}) {
  const method = init.method ?? "GET";
  const body = init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body);
  const req = request({
    host: "127.0.0.1",
    port,
    path,
    method,
    agent: false,
    headers: {
      host: init.host ?? `127.0.0.1:${P}`,
      ...sameOrigin(method),
      ...(body !== undefined && { "content-type": "application/json" }),
      ...init.headers,
    },
  });
  if (body !== undefined) req.write(body);
  req.end();
  return req;
}

export function call(port: number, path: string, init: CallInit = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = open(port, path, init);
    req.on("error", reject);
    req.on("response", (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (d: string) => {
        text += d;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
    });
  });
}

export type Stream = { status: number; headers: IncomingMessage["headers"]; text(): string; ended: Promise<void>; disconnect(): void };

export function stream(port: number, path: string, init: CallInit = {}): Promise<Stream> {
  return new Promise((resolve, reject) => {
    const req = open(port, path, init);
    req.on("error", reject);
    req.on("response", (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (d: string) => {
        text += d;
      });
      const ended = new Promise<void>((done) => {
        res.on("end", done);
        res.on("close", done);
      });
      resolve({ status: res.statusCode ?? 0, headers: res.headers, text: () => text, ended, disconnect: () => req.destroy() });
    });
  });
}

export async function waitFor(check: () => boolean, ms = 20_000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
}

export type StubModel = { url: string; completions: number; open: number; aborted: number; close(): Promise<void> };

const chunk = (content: string) =>
  `data: ${JSON.stringify({
    id: "chatcmpl-stub",
    object: "chat.completion.chunk",
    created: 0,
    model: "stub",
    choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
  })}\n\n`;

export async function stubModel(opts: { chunks?: number; everyMs?: number } = {}): Promise<StubModel> {
  const total = opts.chunks ?? 400;
  const every = opts.everyMs ?? 40;
  const state = { completions: 0, open: 0, aborted: 0 };
  const server: Server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ object: "list", data: [{ id: "stub", object: "model" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      req.resume();
      state.completions += 1;
      state.open += 1;
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      let sent = 0;
      let finished = false;
      const timer = setInterval(() => {
        if (sent >= total) {
          clearInterval(timer);
          finished = true;
          res.write(
            `data: ${JSON.stringify({ id: "chatcmpl-stub", object: "chat.completion.chunk", created: 0, model: "stub", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
          );
          res.end("data: [DONE]\n\n");
          return;
        }
        sent += 1;
        res.write(chunk(`word${sent} `));
      }, every);
      res.on("close", () => {
        clearInterval(timer);
        state.open -= 1;
        if (!finished) state.aborted += 1;
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return Object.assign(state, {
    url: `http://127.0.0.1:${port}/v1`,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  });
}

export function userContext(model: string) {
  return {
    description: "user_context",
    value: JSON.stringify({ timeZone: "UTC", locale: "en-US", localTime: "2026-11-03 10:00", model }),
  };
}

export function runInput(threadId: string, model: string, text = "Tell me a long story.") {
  return {
    threadId,
    runId: `r-${Math.random().toString(36).slice(2, 10)}`,
    messages: [{ id: `m-${Math.random().toString(36).slice(2, 10)}`, role: "user", content: text }],
    tools: [],
    context: [userContext(model)],
    state: {},
    forwardedProps: {},
  };
}

export const textDeltas = (sse: string) => (sse.match(/"type":"TEXT_MESSAGE_CONTENT"/g) ?? []).length;

export const tcpServers = () => process.getActiveResourcesInfo().filter((r) => r === "TCPServerWrap").length;

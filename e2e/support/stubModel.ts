import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const STUB_MODEL = "stub-1";
export const STUB_DEFAULT_PORT = 18341;
export const REPORT_MARKER = "[e2e:report]";
export const LONG_MARKER = "[e2e:long]";
export const STUB_API_KEY = "oab-e2e-stub-key";
export const STUB_REPORT_TITLE = "Stub field notes";

const PORTS = { min: 18000, max: 19999 } as const;
const SHORT_REPLY =
  "Lighthouses mark dangerous coasts. Each one flashes its own pattern. Keepers once trimmed the wicks by hand. Most lights are automatic today.";
const REPORT_REPLY = "Your report is ready.";

export type StubOptions = { port?: number; bind?: string; tokenMs?: number; longTokens?: number; apiKey?: string };
export type StubModel = { server: Server; url: string; requests: () => number; close: () => Promise<void> };

type ChatMessage = { role?: string; content?: unknown };
type ChatRequest = { messages?: ChatMessage[]; stream?: boolean };

export function stubPortProblem(port: number): string | undefined {
  if (Number.isInteger(port) && port >= PORTS.min && port <= PORTS.max) return undefined;
  return `the stub model only listens on ports ${PORTS.min}-${PORTS.max}; got ${port}`;
}

const text = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : "")).join("");
};

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function stubReport(prompt: string): { title: string; html: string } {
  const title = prompt.replace(REPORT_MARKER, "").replace(/\s+/g, " ").trim().slice(0, 120) || STUB_REPORT_TITLE;
  const safe = escapeHtml(title);
  return {
    title,
    html: `<!doctype html><html><head><title>${safe}</title></head><body><h1>${safe}</h1><p>Lighthouses guide ships with light and sound.</p></body></html>`,
  };
}

type Turn = { kind: "tool"; report: { title: string; html: string } } | { kind: "text"; tokens: string[] };

export function stubTurn(body: ChatRequest, longTokens = 400): Turn {
  const messages = body.messages ?? [];
  const last = messages.at(-1);
  const prompt = text([...messages].reverse().find((m) => m.role === "user")?.content);
  if (last?.role === "user" && prompt.includes(REPORT_MARKER)) return { kind: "tool", report: stubReport(prompt) };
  if (last?.role === "tool") return { kind: "text", tokens: words(REPORT_REPLY) };
  if (prompt.includes(LONG_MARKER)) {
    return { kind: "text", tokens: Array.from({ length: longTokens }, (_, i) => `${i % 12 === 11 ? "Beacon." : "beacon"} `) };
  }
  return { kind: "text", tokens: words(SHORT_REPLY) };
}

const words = (s: string): string[] => s.split(/(?<= )/);

const chunk = (id: string, delta: object, finish: string | null = null) => ({
  id,
  object: "chat.completion.chunk",
  created: Math.floor(Date.now() / 1000),
  model: STUB_MODEL,
  choices: [{ index: 0, delta, finish_reason: finish }],
});

const usage = (id: string) => ({
  id,
  object: "chat.completion.chunk",
  created: Math.floor(Date.now() / 1000),
  model: STUB_MODEL,
  choices: [],
  usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
});

async function readBody(req: IncomingMessage): Promise<ChatRequest> {
  const parts: Buffer[] = [];
  for await (const part of req) parts.push(part as Buffer);
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8")) as ChatRequest;
  } catch {
    return {};
  }
}

const json = (res: ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
};

async function completions(req: IncomingMessage, res: ServerResponse, opts: Required<Pick<StubOptions, "tokenMs" | "longTokens">>) {
  const body = await readBody(req);
  const turn = stubTurn(body, opts.longTokens);
  const id = `chatcmpl-stub-${Date.now()}`;
  if (body.stream !== true) {
    const message =
      turn.kind === "tool"
        ? { role: "assistant", content: null, tool_calls: [toolCall(turn.report)] }
        : { role: "assistant", content: turn.tokens.join("") };
    return json(res, 200, {
      id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: STUB_MODEL,
      choices: [{ index: 0, message, finish_reason: turn.kind === "tool" ? "tool_calls" : "stop" }],
      usage: usage(id).usage,
    });
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  let closed = false;
  res.on("close", () => {
    closed = true;
  });
  const send = (value: unknown) => {
    if (!closed) res.write(`data: ${JSON.stringify(value)}\n\n`);
  };
  send(chunk(id, { role: "assistant", content: "" }));
  if (turn.kind === "tool") {
    send(chunk(id, { tool_calls: [{ index: 0, ...toolCall(turn.report) }] }));
    send(chunk(id, {}, "tool_calls"));
  } else {
    for (const token of turn.tokens) {
      if (closed) return;
      send(chunk(id, { content: token }));
      await new Promise((r) => setTimeout(r, opts.tokenMs));
    }
    send(chunk(id, {}, "stop"));
  }
  send(usage(id));
  if (!closed) res.end("data: [DONE]\n\n");
}

const toolCall = (report: { title: string; html: string }) => ({
  id: `call_stub_${Date.now()}`,
  type: "function",
  function: { name: "create_artifact", arguments: JSON.stringify(report) },
});

export async function startStubModel(options: StubOptions = {}): Promise<StubModel> {
  const port = options.port ?? STUB_DEFAULT_PORT;
  const problem = stubPortProblem(port);
  if (problem) throw new Error(problem);
  const bind = options.bind?.trim() || "127.0.0.1";
  const opts = { tokenMs: options.tokenMs ?? 60, longTokens: options.longTokens ?? 400 };
  const bearer = `Bearer ${options.apiKey ?? STUB_API_KEY}`;
  let count = 0;
  const server = createServer((req, res) => {
    count += 1;
    const path = (req.url ?? "/").split("?")[0].replace(/\/+$/, "");
    if (path === "/v1/chat/completions" && req.headers.authorization !== bearer) {
      return json(res, 401, { error: { message: "the stub model needs its API key" } });
    }
    if (req.method === "GET" && path === "/v1/models") {
      return json(res, 200, { object: "list", data: [{ id: STUB_MODEL, object: "model", owned_by: "e2e" }] });
    }
    if (req.method === "POST" && path === "/v1/chat/completions") {
      completions(req, res, opts).catch(() => res.destroy());
      return;
    }
    json(res, 404, { error: { message: "not found" } });
  });
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(port, bind, () => ok());
  });
  const address = server.address() as AddressInfo;
  return {
    server,
    url: `http://${address.address}:${address.port}/v1`,
    requests: () => count,
    close: () =>
      new Promise<void>((ok) => {
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.STUB_PORT ?? STUB_DEFAULT_PORT);
  startStubModel({ port, bind: process.env.STUB_BIND }).then(
    (stub) => {
      console.log(`stub model listening on ${stub.url}`);
      const stop = () => void stub.close().then(() => process.exit(0));
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    },
    (err: Error) => {
      console.error(`stub model refused: ${err.message}`);
      process.exit(2);
    },
  );
}

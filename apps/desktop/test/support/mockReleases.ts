import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const LATEST_PATH = "/repos/Nit-1997/open-agent-bot/releases/latest";

export type MockRoute = Readonly<{ status: number; headers?: Record<string, string>; body?: string | Buffer; hang?: boolean }>;
export type MockRequest = Readonly<{ method: string; path: string; headers: Record<string, string | string[] | undefined> }>;

export type MockReleases = Readonly<{
  port: number;
  origin: string;
  latestUrl: string;
  route(path: string, r: MockRoute): void;
  release(body: unknown): void;
  asset(name: string, body: unknown): string;
  redirect(from: string, to: string, status?: number): void;
  requests(): MockRequest[];
  stop(): Promise<void>;
}>;

const json = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

export async function startMockReleases(o: { port: number; log?: string }): Promise<MockReleases> {
  const routes = new Map<string, MockRoute>();
  const seen: MockRequest[] = [];
  const sockets = new Set<Socket>();
  const origin = `http://127.0.0.1:${o.port}`;
  const handle = (req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url ?? "/", origin).pathname;
    const entry = { method: req.method ?? "GET", path, headers: { ...req.headers } };
    seen.push(entry);
    if (o.log) appendFileSync(o.log, `${JSON.stringify({ method: entry.method, path })}\n`);
    const r = routes.get(path);
    if (!r) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end('{"message":"Not Found"}');
      return;
    }
    if (r.hang) return;
    res.writeHead(r.status, { "content-type": "application/json", ...r.headers });
    res.end(r.body ?? "");
  };
  const server: Server = createServer(handle);
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((res, rej) => {
    server.once("error", rej);
    server.listen(o.port, "127.0.0.1", () => res());
  });
  return {
    port: o.port,
    origin,
    latestUrl: `${origin}${LATEST_PATH}`,
    route: (path, r) => routes.set(path, r),
    release: (body) => routes.set(LATEST_PATH, { status: 200, body: json(body) }),
    asset: (name, body) => {
      const path = `/assets/${name}`;
      routes.set(path, { status: 200, headers: { "content-type": "application/octet-stream" }, body: json(body) });
      return `${origin}${path}`;
    },
    redirect: (from, to, status = 302) => routes.set(from, { status, headers: { location: to } }),
    requests: () => [...seen],
    stop: () =>
      new Promise<void>((res) => {
        for (const s of sockets) s.destroy();
        server.close(() => res());
      }),
  };
}

export const ORIGIN_PLACEHOLDER = "{{ORIGIN}}";

export function serveTree(m: MockReleases, dir: string): void {
  const sub = (text: string) => text.replaceAll(ORIGIN_PLACEHOLDER, m.origin);
  m.release(sub(readFileSync(join(dir, "latest.json"), "utf8")));
  let names: string[] = [];
  try {
    names = readdirSync(join(dir, "assets"));
  } catch {}
  for (const name of names) m.asset(name, sub(readFileSync(join(dir, "assets", name), "utf8")));
}

async function cli(argv: readonly string[]): Promise<void> {
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const port = Number(arg("--port"));
  const dir = arg("--dir");
  if (!Number.isInteger(port) || port < 18000 || port > 19999 || !dir) {
    process.stderr.write("usage: mockReleases.ts --port <18000-19999> --dir <tree> [--log <file>]\n");
    process.exit(64);
  }
  const log = arg("--log");
  const m = await startMockReleases({ port, ...(log ? { log: resolve(log) } : {}) });
  serveTree(m, resolve(dir));
  process.stdout.write(`[mock-releases] listening ${m.latestUrl}\n`);
  const stop = () => void m.stop().then(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void cli(process.argv.slice(2));

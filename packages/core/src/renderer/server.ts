import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { MAX_ARTIFACT_BYTES } from "../artifacts/store.js";
import { createLimiter } from "../lib/concurrency.js";
import { log } from "../lib/log.js";

export const MAX_RENDER_BYTES = MAX_ARTIFACT_BYTES;
const RENDER_SLOTS = 2;
const TYPES = { pdf: "application/pdf", thumb: "image/jpeg" } as const;
const SECRET_NAME = /SECRET|_KEY|KEYS|TOKEN|PASSWORD|PEPPER|CREDENTIAL|^SUPABASE_/i;

export type RenderEngine = { pdf(html: string): Promise<Buffer>; thumb(html: string): Promise<Buffer> };

export function forbiddenEnv(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env)
    .filter((name) => name !== "RENDERER_SECRET" && SECRET_NAME.test(name))
    .sort();
}

const digest = (v: string) => createHash("sha256").update(v, "utf8").digest();

class TooLarge extends Error {}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size <= MAX_RENDER_BYTES) chunks.push(chunk);
  }
  if (size > MAX_RENDER_BYTES) throw new TooLarge();
  return Buffer.concat(chunks).toString("utf8");
}

export function createRendererServer(deps: { secret: string; engine: RenderEngine }): Server {
  const expected = digest(`Bearer ${deps.secret}`);
  const slot = createLimiter(RENDER_SLOTS);
  const send = (res: ServerResponse, status: number, body: string | Buffer, type = "text/plain; charset=utf-8") => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" }).end(body);
  };

  return createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") return send(res, 200, "ok");
    const kind = req.method === "POST" && /^\/render\/(pdf|thumb)$/.exec(req.url ?? "")?.[1];
    if (kind !== "pdf" && kind !== "thumb") return send(res, 404, "not found");
    if (!timingSafeEqual(digest(req.headers.authorization ?? ""), expected)) return send(res, 401, "unauthorized");
    let html: string;
    try {
      html = await readBody(req);
    } catch (err) {
      return send(res, err instanceof TooLarge ? 413 : 400, err instanceof TooLarge ? "too large" : "bad request");
    }
    try {
      const out = await slot(() => deps.engine[kind](html));
      send(res, 200, out, TYPES[kind]);
    } catch (err) {
      log.warn(`[renderer] ${kind} failed`, err);
      if (!res.headersSent) send(res, 500, "render failed");
    }
  });
}

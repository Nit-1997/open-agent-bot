import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type SiteVerifyRequest = { secret: string | null; response: string | null; remoteip: string | null; contentType?: string };

export type SiteVerifyReply = { status?: number; body?: unknown; raw?: string; delayMs?: number };

export type SiteVerifyStub = {
  url: string;
  requests: SiteVerifyRequest[];
  reply: (req: SiteVerifyRequest) => SiteVerifyReply;
  close(): Promise<void>;
};

export const passing = (over: Record<string, unknown> = {}) => ({
  success: true,
  "error-codes": [],
  challenge_ts: "2026-11-04T10:00:00.000Z",
  hostname: "app.localhost",
  action: "human_check",
  ...over,
});

export async function startSiteVerify(reply?: SiteVerifyStub["reply"]): Promise<SiteVerifyStub> {
  const used = new Set<string>();
  const stub: SiteVerifyStub = {
    url: "",
    requests: [],
    reply:
      reply ??
      ((req) => {
        if (req.response && used.has(req.response)) return { body: { success: false, "error-codes": ["timeout-or-duplicate"] } };
        if (req.response) used.add(req.response);
        return { body: passing() };
      }),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  const server: Server = createServer((req, res) => {
    let text = "";
    req.on("data", (chunk) => {
      text += chunk;
    });
    req.on("end", () => {
      const form = new URLSearchParams(text);
      const parsed: SiteVerifyRequest = {
        secret: form.get("secret"),
        response: form.get("response"),
        remoteip: form.get("remoteip"),
        contentType: req.headers["content-type"],
      };
      stub.requests.push(parsed);
      const r = stub.reply(parsed);
      const send = () => {
        res.writeHead(r.status ?? 200, { "content-type": "application/json" });
        res.end(r.raw ?? JSON.stringify(r.body ?? {}));
      };
      if (r.delayMs) setTimeout(send, r.delayMs);
      else send();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  stub.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/siteverify`;
  return stub;
}

import { request } from "node:http";

export type Health = Readonly<{ ok: boolean; app?: string; version?: string; schema?: number }>;

export interface HealthClient {
  get(port: number, timeoutMs: number): Promise<Health | undefined>;
}

const MAX = 64 * 1024;

export const httpHealth: HealthClient = {
  get: (port, timeoutMs) =>
    new Promise((resolve) => {
      const req = request(
        { host: "127.0.0.1", port, path: "/health", method: "GET", timeout: timeoutMs, headers: { accept: "application/json" } },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (d: string) => {
            body += d;
            if (body.length > MAX) req.destroy();
          });
          res.on("end", () => {
            if (res.statusCode !== 200) return resolve({ ok: false });
            try {
              const v = JSON.parse(body) as Record<string, unknown>;
              resolve({
                ok: v.ok === true,
                ...(typeof v.app === "string" ? { app: v.app } : {}),
                ...(typeof v.version === "string" ? { version: v.version } : {}),
                ...(typeof v.schema === "number" ? { schema: v.schema } : {}),
              });
            } catch {
              resolve({ ok: false });
            }
          });
          res.on("error", () => resolve(undefined));
        },
      );
      req.on("timeout", () => req.destroy());
      req.on("error", () => resolve(undefined));
      req.end();
    }),
};

export const isOpenAgent = (h: Health | undefined): h is Health => h?.ok === true && h.app === "open-agent";

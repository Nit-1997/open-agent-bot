import { request } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ProbeReply = { status: number; acao: number };
export type Send = (method: string, path: string, headers: Record<string, string>) => Promise<ProbeReply>;

type Probe = { name: string; method: string; path: string; headers: Record<string, string>; expect: number | "refused-or-ok" };

const TARGET_RE = /^http:\/\/127\.0\.0\.1:(1[89]\d{3})$/;
const EVIL = "http://evil.example";
const JSON_TYPE = { "content-type": "application/json" };
const PREFLIGHT = { origin: EVIL, "access-control-request-method": "POST" };

export function probeTarget(raw: string | undefined): { origin: string; port: number } {
  const origin = raw?.trim() ?? "";
  const port = Number(TARGET_RE.exec(origin)?.[1]);
  if (!port)
    throw new Error(`refusing to probe: APP_ORIGIN must be http://127.0.0.1:18000-19999, got '${origin.replace(/\/\/[^/@]*@/, "//***@")}'`);
  return { origin, port };
}

export function localProbes(origin: string, port: number): Probe[] {
  return [
    { name: "wrong Host on /", method: "GET", path: "/", headers: { host: "evil.example" }, expect: 421 },
    { name: "wrong Host on /api/chats", method: "GET", path: "/api/chats", headers: { host: `rebind.example:${port}` }, expect: 421 },
    { name: "PUT /api/profile, foreign Origin", method: "PUT", path: "/api/profile", headers: { ...JSON_TYPE, origin: EVIL }, expect: 403 },
    { name: "PUT /api/profile, Origin null", method: "PUT", path: "/api/profile", headers: { ...JSON_TYPE, origin: "null" }, expect: 403 },
    { name: "PUT /api/profile, no Origin", method: "PUT", path: "/api/profile", headers: JSON_TYPE, expect: 403 },
    {
      name: "GET /api/chats, Sec-Fetch-Site cross-site",
      method: "GET",
      path: "/api/chats",
      headers: { "sec-fetch-site": "cross-site" },
      expect: 403,
    },
    {
      name: "GET /api/chats, Sec-Fetch-Site same-site",
      method: "GET",
      path: "/api/chats",
      headers: { "sec-fetch-site": "same-site" },
      expect: 403,
    },
    { name: "OPTIONS /api/chats", method: "OPTIONS", path: "/api/chats", headers: PREFLIGHT, expect: "refused-or-ok" },
    { name: "OPTIONS /api/profile", method: "OPTIONS", path: "/api/profile", headers: PREFLIGHT, expect: "refused-or-ok" },
    { name: "OPTIONS /api/copilotkit/info", method: "OPTIONS", path: "/api/copilotkit/info", headers: PREFLIGHT, expect: "refused-or-ok" },
    { name: "OPTIONS /", method: "OPTIONS", path: "/", headers: PREFLIGHT, expect: "refused-or-ok" },
    { name: "GET /api/chats, foreign Origin", method: "GET", path: "/api/chats", headers: { origin: EVIL }, expect: "refused-or-ok" },
    {
      name: "GET /api/chats, same origin (control)",
      method: "GET",
      path: "/api/chats",
      headers: { origin, "sec-fetch-site": "same-origin" },
      expect: 200,
    },
  ];
}

export function httpSend(port: number): Send {
  const host = `127.0.0.1:${port}`;
  return (method, path, headers) =>
    new Promise((ok, fail) => {
      const req = request({ host: "127.0.0.1", port, method, path, headers: { host, ...headers }, setHost: false }, (res) => {
        res.resume();
        res.on("end", () =>
          ok({ status: res.statusCode ?? 0, acao: Object.keys(res.headers).filter((h) => h.startsWith("access-control-allow-")).length }),
        );
      });
      req.on("error", fail);
      req.end(method === "PUT" || method === "POST" ? "{}" : undefined);
    });
}

export async function runLocalProbes(raw: string | undefined, log: (line: string) => void, send?: Send): Promise<number> {
  const { origin, port } = probeTarget(raw);
  const transport = send ?? httpSend(port);
  let unexpected = 0;
  log(`${"probe".padEnd(44)} status  expect  acao`);
  for (const p of localProbes(origin, port)) {
    const { status, acao } = await transport(p.method, p.path, p.headers);
    const statusOk = p.expect === "refused-or-ok" ? status === 200 || status >= 400 : status === p.expect;
    const ok = statusOk && acao === 0;
    if (!ok) unexpected += 1;
    log(
      `${p.name.padEnd(44)} ${String(status).padEnd(7)} ${String(p.expect === "refused-or-ok" ? "any" : p.expect).padEnd(7)} ${acao}     ${ok ? "ok" : "UNEXPECTED"}`,
    );
  }
  log(unexpected === 0 ? "local probes: all as expected" : `local probes: ${unexpected} unexpected`);
  return unexpected;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLocalProbes(process.env.APP_ORIGIN, console.log).then(
    (unexpected) => process.exit(unexpected === 0 ? 0 : 1),
    (err: Error) => {
      console.error(err.message);
      process.exit(2);
    },
  );
}

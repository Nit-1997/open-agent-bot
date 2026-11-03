import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { previewOriginProblem } from "../support/origin.ts";

type Env = Readonly<Record<string, string | undefined>>;
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export type Session = { secret: string; demoToken: string; demoCookie: string; otherToken: string; bigSur: string };

export type ProbeIo = {
  fetch: Fetch;
  prepare: () => Promise<Session>;
  finish: () => Promise<void>;
  log: (line: string) => void;
};

type Probe = {
  name: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  status: number;
  code?: string;
  header?: [string, string];
};

const ROOT = resolve(fileURLToPath(import.meta.url), "../../..");
const EVIL = "https://evil.example";
const RUN = "/copilotkit/agent/openagent/run";

export function originProblems(env: Env): string[] {
  return [previewOriginProblem(env.APP_ORIGIN, "APP_ORIGIN"), previewOriginProblem(env.AGENT_ORIGIN, "AGENT_ORIGIN")].filter(
    (problem): problem is string => problem !== undefined,
  );
}

function webProbes(app: string, s: Session): Probe[] {
  const signedIn = { cookie: s.demoCookie };
  return [
    { name: "web, no cookies", method: "GET", url: `${app}/api/chats`, status: 401, code: "signed_out" },
    { name: "web, no cookies", method: "POST", url: `${app}/api${RUN}`, headers: { origin: app }, body: {}, status: 401, code: "signed_out" },
    { name: "web, evil origin", method: "PUT", url: `${app}/api/profile`, headers: { ...signedIn, origin: EVIL }, body: {}, status: 403, code: "bad_origin" },
    { name: "web, evil origin", method: "POST", url: `${app}/api${RUN}`, headers: { ...signedIn, origin: EVIL }, body: {}, status: 403, code: "bad_origin" },
    { name: "web, signed in", method: "GET", url: `${app}/api/copilotkit/threads?agentId=openagent`, headers: signedIn, status: 404, code: "not_found" },
    { name: "web, signed in", method: "PATCH", url: `${app}/api/copilotkit/info`, headers: { ...signedIn, origin: app }, status: 405, code: "method_not_allowed" },
    { name: "web, signed in", method: "GET", url: `${app}/api/copilotkit/info`, headers: signedIn, status: 200, header: ["cache-control", "private, no-store"] },
    { name: "web, signed in, no threadId", method: "POST", url: `${app}/api${RUN}`, headers: { ...signedIn, origin: app }, body: {}, status: 400, code: "invalid" },
  ];
}

function agentProbes(agent: string, s: Session): Probe[] {
  const as = (token: string) => ({ "x-agent-secret": s.secret, authorization: `Bearer ${token}` });
  return [
    { name: "agent, no secret", method: "GET", url: `${agent}/copilotkit/info`, status: 401 },
    { name: "agent, secret but no bearer", method: "GET", url: `${agent}/copilotkit/info`, headers: { "x-agent-secret": s.secret }, status: 401, code: "signed_out" },
    { name: "agent, other user's stop on the demo chat", method: "POST", url: `${agent}/copilotkit/agent/openagent/stop/${s.bigSur}`, headers: as(s.otherToken), body: {}, status: 403, code: "forbidden" },
    { name: "agent, other user's connect on the demo chat", method: "POST", url: `${agent}/copilotkit/agent/openagent/connect`, headers: as(s.otherToken), body: { threadId: s.bigSur }, status: 403, code: "forbidden" },
    { name: "agent, nested path", method: "GET", url: `${agent}/copilotkit/a/b/info`, headers: as(s.demoToken), status: 404, code: "not_found" },
    { name: "agent, run without threadId", method: "POST", url: `${agent}${RUN}`, headers: as(s.demoToken), body: {}, status: 400, code: "invalid" },
    { name: "agent, control", method: "GET", url: `${agent}/copilotkit/info`, headers: as(s.demoToken), status: 200 },
  ];
}

async function errorCode(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const error = (JSON.parse(text) as { error?: unknown }).error;
    return typeof error === "string" ? error : "";
  } catch {
    return "";
  }
}

async function check(io: ProbeIo, p: Probe): Promise<boolean> {
  const headers: Record<string, string> = { ...p.headers };
  if (p.body !== undefined) headers["content-type"] = "application/json";
  const res = await io.fetch(p.url, { method: p.method, headers, body: p.body === undefined ? undefined : JSON.stringify(p.body), redirect: "manual" });
  const code = await errorCode(res);
  const header = p.header ? res.headers.get(p.header[0]) ?? "" : undefined;
  const ok = res.status === p.status && (p.code === undefined || code === p.code) && (p.header === undefined || header === p.header[1]);
  const path = new URL(p.url);
  const want = [p.status, p.code, p.header && `${p.header[0]}: ${p.header[1]}`].filter(Boolean).join(" ");
  const got = [res.status, code, p.header && `${p.header[0]}: ${header}`].filter(Boolean).join(" ");
  io.log(`${ok ? "PASS" : "FAIL"} ${p.name}: ${p.method} ${path.host}${path.pathname} -> ${got} (expected ${want})`);
  return ok;
}

export async function runAuthProbes(env: Env, io: ProbeIo): Promise<number> {
  const problems = originProblems(env);
  if (problems.length > 0) {
    for (const problem of problems) io.log(`refusing to probe: ${problem}`);
    return 1;
  }
  const app = env.APP_ORIGIN?.trim() as string;
  const agent = env.AGENT_ORIGIN?.trim() as string;
  let ok = true;
  try {
    const session = await io.prepare();
    io.log(`probing web ${app} and agent ${agent} (tokens and secret not printed)`);
    for (const probe of [...webProbes(app, session), ...agentProbes(agent, session)]) ok = (await check(io, probe)) && ok;
  } catch (err) {
    io.log(`probe run failed: ${err instanceof Error ? err.message : String(err)}`);
    ok = false;
  } finally {
    await io.finish();
    io.log("e2e users cleaned up");
  }
  io.log(ok ? "ALL PROBES PASS" : "SOME PROBES FAILED");
  return ok ? 0 : 1;
}

type StorageState = { cookies: Array<{ name: string; value: string }> };

const readState = (path: string) => JSON.parse(readFileSync(path, "utf8")) as StorageState;

function accessToken(state: StorageState): string {
  const parts = state.cookies
    .filter((c) => /^sb-[a-z0-9]+-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => Number(a.name.split(".")[1] ?? 0) - Number(b.name.split(".")[1] ?? 0));
  let raw = decodeURIComponent(parts.map((c) => c.value).join(""));
  if (raw.startsWith("base64-")) raw = Buffer.from(raw.slice(7), "base64url").toString("utf8");
  const token = (JSON.parse(raw) as { access_token?: unknown }).access_token;
  if (typeof token !== "string") throw new Error("no access token in the session cookie");
  return token;
}

const cookieHeader = (state: StorageState) => state.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

function agentSecret(): string {
  const line = readFileSync(resolve(ROOT, "deploy-config/.env-agent"), "utf8")
    .split("\n")
    .find((l) => l.trim().startsWith("AGENT_SERVICE_SECRET="));
  const secret = line?.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
  if (!secret) throw new Error("AGENT_SERVICE_SECRET missing in deploy-config/.env-agent");
  return secret;
}

function previewIo(): ProbeIo {
  return {
    fetch: (url, init) => fetch(url, init),
    log: (line) => console.log(line),
    prepare: async () => {
      const [{ default: setup }, users, state] = await Promise.all([import("../global-setup.ts"), import("../support/users.ts"), import("../support/state.ts")]);
      await setup({} as Parameters<typeof setup>[0]);
      const demo = readState(users.storageFor(users.DEMO_USER));
      const other = readState(users.storageFor(users.OTHER_USER));
      return { secret: agentSecret(), demoToken: accessToken(demo), demoCookie: cookieHeader(demo), otherToken: accessToken(other), bigSur: state.seeded().bigSur };
    },
    finish: async () => {
      const { default: teardown } = await import("../global-teardown.ts");
      await teardown();
    },
  };
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) process.exitCode = await runAuthProbes(process.env, previewIo());

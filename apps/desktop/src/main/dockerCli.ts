import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { ComposeVars } from "./compose.ts";
import { currentUid, type FsProbe, type FsStat, realFs } from "./fsProbe.ts";
import type { Log } from "./logger.ts";
import { redact } from "./redact.ts";
import type { ShellConfig } from "./shellConfig.ts";
import { obj } from "../shared/util.ts";

export type DockerLocation =
  | { kind: "found"; path: string; searched: string[]; rejected: Rejected[] }
  | { kind: "missing"; searched: string[]; rejected: Rejected[] };
export type Rejected = Readonly<{ path: string; reason: string }>;

export type Engine = "docker-desktop" | "orbstack" | "colima" | "rancher-desktop" | "other";
export type DockerProbe =
  | { kind: "ok"; client: string; server: string; compose: string; context: string; engine: Engine; arch: string; memBytes?: number }
  | { kind: "stopped"; client: string; stderrTail: string }
  | { kind: "compose_old"; compose?: string }
  | { kind: "not_linux"; os: string };

export type RunResult = Readonly<{ code: number | null; signal?: string; stdout: string; stderr: string; ms: number }>;
export type RunOptions = Readonly<{
  env: Record<string, string>;
  timeoutMs?: number;
  onStdoutLine?: (l: string) => void;
  onStderrLine?: (l: string) => void;
  stdoutTo?: NodeJS.WritableStream;
  signal?: AbortSignal;
  quiet?: boolean;
}>;

export interface DockerCli {
  readonly path: string;
  run(args: readonly string[], o: RunOptions): Promise<RunResult>;
}

export const ADMIN_GID = 80;

export function dockerCandidates(home: string): string[] {
  return [
    "/usr/local/bin/docker",
    "/opt/homebrew/bin/docker",
    join(home, ".docker/bin/docker"),
    join(home, ".orbstack/bin/docker"),
    "/Applications/Docker.app/Contents/Resources/bin/docker",
    "/Applications/OrbStack.app/Contents/MacOS/xbin/docker",
    join(home, ".rd/bin/docker"),
    "/usr/bin/docker",
  ];
}

const parents = (p: string): string[] => {
  const out: string[] = [];
  let d = dirname(p);
  for (;;) {
    out.push(d);
    if (d === "/" || d === ".") return out;
    d = dirname(d);
  }
};

function entryProblem(st: FsStat | undefined, uid: number): string | undefined {
  if (!st) return "is missing";
  if (st.uid !== 0 && st.uid !== uid) return `is owned by uid ${st.uid}`;
  if (st.kind === "symlink") return undefined;
  if (st.mode & 0o002) return "is other-writable";
  if (st.mode & 0o020 && st.gid !== ADMIN_GID) return "is group-writable";
  return undefined;
}

export function trustedDir(path: string, uid: number, fs: FsProbe = realFs): { ok: true } | { ok: false; reason: string } {
  const real = fs.realpath(path);
  if (!real) return { ok: false, reason: `${path}: is missing` };
  for (const p of [...new Set([path, ...parents(path), real, ...parents(real)])]) {
    const problem = entryProblem(fs.lstat(p), uid);
    if (problem) return { ok: false, reason: `${path}: ${p === path ? "directory" : p === real ? "target" : "parent"} ${p} ${problem}` };
  }
  return { ok: true };
}

export function trustedPath(path: string, uid: number, fs: FsProbe = realFs): { ok: true } | { ok: false; reason: string } {
  const link = fs.lstat(path);
  if (!link) return { ok: false, reason: `${path}: not found` };
  const real = fs.realpath(path);
  const target = real ? fs.stat(real) : undefined;
  if (!real || !target) return { ok: false, reason: `${path}: broken link` };
  if (target.kind !== "file") return { ok: false, reason: `${path}: not a regular file` };
  if (!fs.executable(real)) return { ok: false, reason: `${path}: not executable` };
  const checks: [string, string][] = [
    [path, "file"],
    ...parents(path).map((p): [string, string] => [p, "parent"]),
    ...(real === path ? [] : [[real, "target"] as [string, string]]),
    ...parents(real).map((p): [string, string] => [p, "parent"]),
  ];
  const seen = new Set<string>();
  for (const [p, role] of checks) {
    if (seen.has(p)) continue;
    seen.add(p);
    const problem = entryProblem(fs.lstat(p), uid);
    if (problem) return { ok: false, reason: role === "file" ? `${path}: ${problem}` : `${path}: ${role} ${p} ${problem}` };
  }
  return { ok: true };
}

export function locateDocker(
  cfg: Pick<ShellConfig, "test" | "dockerOverride">,
  o: { fs?: FsProbe; uid?: number; home?: string } = {},
): DockerLocation {
  const fs = o.fs ?? realFs;
  const uid = o.uid ?? currentUid();
  const searched = cfg.test && cfg.dockerOverride ? [cfg.dockerOverride] : dockerCandidates(o.home ?? homedir());
  const rejected: Rejected[] = [];
  for (const path of searched) {
    if (!fs.lstat(path)) continue;
    const t = trustedPath(path, uid, fs);
    if (t.ok) return { kind: "found", path, searched, rejected };
    rejected.push({ path, reason: t.reason });
  }
  return { kind: "missing", searched, rejected };
}

export const SYSTEM_PLUGIN_DIRS = [
  "/usr/local/lib/docker/cli-plugins",
  "/usr/local/libexec/docker/cli-plugins",
  "/usr/lib/docker/cli-plugins",
  "/usr/libexec/docker/cli-plugins",
] as const;

const dockerDir = (home?: string) => join(home ?? homedir(), ".docker");

function configExtraDirs(fs: FsProbe, home?: string): unknown[] {
  const text = fs.readText?.(join(dockerDir(home), "config.json"));
  if (text === undefined) return [];
  try {
    const dirs = obj(JSON.parse(text))?.cliPluginsExtraDirs;
    return Array.isArray(dirs) ? dirs : [];
  } catch {
    return [];
  }
}

const isAbsoluteDir = (d: unknown): d is string => typeof d === "string" && isAbsolute(d);

export function cliPluginDirs(o: { fs?: FsProbe; home?: string } = {}): string[] {
  const extra = configExtraDirs(o.fs ?? realFs, o.home).filter(isAbsoluteDir);
  return [...new Set([join(dockerDir(o.home), "cli-plugins"), ...extra, ...SYSTEM_PLUGIN_DIRS])];
}

export function cliPluginsProblem(o: { fs?: FsProbe; uid?: number; home?: string } = {}): Rejected | undefined {
  const fs = o.fs ?? realFs;
  const uid = o.uid ?? currentUid();
  const bad = configExtraDirs(fs, o.home).find((d) => !isAbsoluteDir(d));
  if (bad !== undefined)
    return { path: typeof bad === "string" ? bad : JSON.stringify(bad), reason: "cliPluginsExtraDirs entry is not an absolute path" };
  for (const dir of cliPluginDirs(o)) {
    if (!fs.lstat(dir)) continue;
    const t = trustedDir(dir, uid, fs);
    if (!t.ok) return { path: dir, reason: t.reason };
    for (const name of (fs.list?.(dir) ?? []).sort()) {
      if (!name.startsWith("docker-")) continue;
      const path = join(dir, name);
      if (!fs.realpath(path)) continue;
      const p = trustedPath(path, uid, fs);
      if (!p.ok) return { path, reason: p.reason };
    }
  }
  return undefined;
}

export async function pluginPathsProblem(
  cli: DockerCli,
  env: Record<string, string>,
  o: { fs?: FsProbe; uid?: number } = {},
): Promise<{ checked: number; problem?: Rejected }> {
  const fs = o.fs ?? realFs;
  const uid = o.uid ?? currentUid();
  const r = await cli.run(["info", "--format", "{{json .ClientInfo.Plugins}}"], { env, timeoutMs: 15_000, quiet: true });
  const list = parseJson(r.stdout);
  if (list === null) return { checked: 0 };
  if (!Array.isArray(list)) return { checked: 0, problem: { path: "docker info", reason: "the CLI plugin list couldn't be read" } };
  const paths = list.map((p) => str(obj(p)?.Path)).filter((p): p is string => p !== undefined);
  for (const path of paths) {
    const t = trustedPath(path, uid, fs);
    if (!t.ok) return { checked: paths.length, problem: { path, reason: t.reason } };
  }
  return { checked: paths.length };
}

export function dockerPath(
  cliPath: string,
  o: { fs?: FsProbe; uid?: number; home?: string; onDropped?: (r: Rejected) => void } = {},
): string {
  const fs = o.fs ?? realFs;
  const uid = o.uid ?? currentUid();
  const home = o.home ?? homedir();
  const real = fs.realpath(cliPath) ?? cliPath;
  const wanted = [
    dirname(cliPath),
    dirname(real),
    "/usr/local/bin",
    "/opt/homebrew/bin",
    join(home, ".docker/bin"),
    join(home, ".orbstack/bin"),
    join(home, ".rd/bin"),
    "/Applications/Docker.app/Contents/Resources/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
  const kept: string[] = [];
  for (const d of [...new Set(wanted)]) {
    if (!fs.lstat(d)) continue;
    const t = trustedDir(d, uid, fs);
    if (t.ok) kept.push(d);
    else o.onDropped?.({ path: d, reason: t.reason });
  }
  return kept.join(":");
}

const PASS_ALWAYS = ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG"] as const;
const PASS_DOCKER = ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY"] as const;
export const COMPOSE_VAR_NAMES = [
  "OPEN_AGENT_PORT",
  "OPEN_AGENT_LAUNCH_TOKEN",
  "OPEN_AGENT_IMAGE",
  "OPEN_AGENT_SEARCH_IMAGE",
  "OPEN_AGENT_DATA_VOLUME",
  "OPEN_AGENT_KEYS_VOLUME",
  "OPEN_AGENT_RESET_CREDENTIALS",
] as const;
export const ENV_ALLOWLIST: readonly string[] = ["PATH", ...PASS_ALWAYS, ...PASS_DOCKER, ...COMPOSE_VAR_NAMES];

export function dockerEnv(path: string, parent: NodeJS.ProcessEnv, compose?: ComposeVars): Record<string, string> {
  const env: Record<string, string> = { PATH: path };
  for (const k of [...PASS_ALWAYS, ...PASS_DOCKER]) {
    const v = parent[k];
    if (v !== undefined && v !== "") env[k] = v;
  }
  if (compose) {
    env.OPEN_AGENT_PORT = String(compose.port);
    env.OPEN_AGENT_LAUNCH_TOKEN = compose.token;
    env.OPEN_AGENT_IMAGE = compose.agentImage;
    env.OPEN_AGENT_SEARCH_IMAGE = compose.searchImage;
    env.OPEN_AGENT_DATA_VOLUME = compose.dataVolume;
    env.OPEN_AGENT_KEYS_VOLUME = compose.keysVolume;
    env.OPEN_AGENT_RESET_CREDENTIALS = compose.resetCredentials ? "1" : "";
  }
  return env;
}

const MAX_CAPTURE = 4 * 1024 * 1024;

const tail = (s: string, n: number) => (s.length > n ? s.slice(s.length - n) : s);

export function createDockerCli(path: string, o: { log: Log; tokens: () => readonly (string | undefined)[] }): DockerCli {
  return {
    path,
    run: (args, r) =>
      new Promise<RunResult>((resolve) => {
        const started = Date.now();
        const child = spawn(path, [...args], { env: r.env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        let outBuf = "";
        let errBuf = "";
        let killTimer: NodeJS.Timeout | undefined;
        let killed: string | undefined;
        const kill = (why: string) => {
          if (child.exitCode !== null || killed) return;
          killed = why;
          child.kill("SIGTERM");
          killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
        };
        const timer = r.timeoutMs ? setTimeout(() => kill("timeout"), r.timeoutMs) : undefined;
        const onAbort = () => kill("aborted");
        if (r.signal?.aborted) onAbort();
        r.signal?.addEventListener("abort", onAbort, { once: true });
        const lines = (chunk: string, buf: string, cb?: (l: string) => void) => {
          const all = buf + chunk;
          const parts = all.split(/\r?\n|\r/);
          const rest = parts.pop() ?? "";
          if (cb) for (const l of parts) cb(l);
          return rest;
        };
        const sink = r.stdoutTo;
        if (sink) {
          child.stdout.on("data", (d: Buffer) => {
            if (!sink.write(d)) {
              child.stdout.pause();
              sink.once("drain", () => child.stdout.resume());
            }
          });
        } else {
          child.stdout.setEncoding("utf8");
          child.stdout.on("data", (d: string) => {
            stdout = tail(stdout + d, MAX_CAPTURE);
            outBuf = lines(d, outBuf, r.onStdoutLine);
          });
        }
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (d: string) => {
          stderr = tail(stderr + d, MAX_CAPTURE);
          errBuf = lines(d, errBuf, r.onStderrLine);
        });
        const finish = (code: number | null, signal: NodeJS.Signals | null, error?: Error) => {
          if (timer) clearTimeout(timer);
          if (killTimer) clearTimeout(killTimer);
          r.signal?.removeEventListener("abort", onAbort);
          if (outBuf && r.onStdoutLine) r.onStdoutLine(outBuf);
          if (errBuf && r.onStderrLine) r.onStderrLine(errBuf);
          const ms = Date.now() - started;
          const result: RunResult = {
            code: error ? null : code,
            ...(signal ? { signal } : killed ? { signal: killed } : {}),
            stdout,
            stderr: error ? `${stderr}${error.message}` : stderr,
            ms,
          };
          const names = Object.keys(r.env).sort().join(",");
          const status = error ? `error=${error.message.split(" ")[0]}` : `exit=${code ?? "null"}${signal ? ` signal=${signal}` : ""}`;
          const line = `[docker] ${args.join(" ")} env=${names} ${status}${killed ? ` ${killed}` : ""} ms=${ms}`;
          if (!r.quiet || code !== 0) o.log.info(redact(line, o.tokens()));
          resolve(result);
        };
        let settled = false;
        child.once("error", (e) => {
          if (settled) return;
          settled = true;
          finish(null, null, e);
        });
        child.once("close", (code, signal) => {
          if (settled) return;
          settled = true;
          finish(code, signal);
        });
      }),
  };
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)/;
export function composeAtLeast(version: string, min: readonly [number, number, number]): boolean {
  const m = SEMVER.exec(version.trim());
  if (!m) return false;
  const v = [Number(m[1]), Number(m[2]), Number(m[3])];
  for (let i = 0; i < 3; i++) {
    if ((v[i] ?? 0) > min[i]!) return true;
    if ((v[i] ?? 0) < min[i]!) return false;
  }
  return true;
}

const parseJson = (s: string): unknown => {
  try {
    return JSON.parse(s.trim().split("\n")[0] ?? "");
  } catch {
    return undefined;
  }
};
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

export function engineOf(info: Record<string, unknown> | undefined, context: string): Engine {
  const os = (str(info?.OperatingSystem) ?? "").toLowerCase();
  const name = (str(info?.Name) ?? "").toLowerCase();
  if (os.includes("docker desktop")) return "docker-desktop";
  if (os.includes("orbstack") || name.includes("orbstack") || context === "orbstack") return "orbstack";
  if (context.startsWith("colima") || name.startsWith("colima")) return "colima";
  if (context === "rancher-desktop" || name.includes("rancher")) return "rancher-desktop";
  return "other";
}

export async function probeDocker(cli: DockerCli, env: Record<string, string>): Promise<DockerProbe> {
  const v = await cli.run(["version", "--format", "{{json .}}"], { env, timeoutMs: 8000 });
  const version = obj(parseJson(v.stdout));
  const client = str(obj(version?.Client)?.Version) ?? "unknown";
  const server = obj(version?.Server);
  if (v.code !== 0 || !server || /cannot connect/i.test(v.stderr))
    return { kind: "stopped", client, stderrTail: tail(v.stderr.trim(), 2000) };
  const os = str(server.Os) ?? "unknown";
  if (os !== "linux") return { kind: "not_linux", os };
  const c = await cli.run(["compose", "version", "--short"], { env, timeoutMs: 15_000 });
  const compose = c.stdout.trim();
  if (c.code !== 0 || !composeAtLeast(compose, [2, 24, 0])) return { kind: "compose_old", ...(compose ? { compose } : {}) };
  const ctx = await cli.run(["context", "show"], { env, timeoutMs: 15_000 });
  const context = ctx.code === 0 ? ctx.stdout.trim() : (str(obj(version?.Client)?.Context) ?? "default");
  const i = await cli.run(["info", "--format", "{{json .}}"], { env, timeoutMs: 15_000 });
  const info = i.code === 0 ? obj(parseJson(i.stdout)) : undefined;
  const mem = info?.MemTotal;
  return {
    kind: "ok",
    client,
    server: str(server.Version) ?? "unknown",
    compose,
    context,
    engine: engineOf(info, context),
    arch: str(server.Arch) ?? "unknown",
    ...(typeof mem === "number" ? { memBytes: mem } : {}),
  };
}

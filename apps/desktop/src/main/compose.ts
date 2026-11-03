import { join } from "node:path";
import type { DockerCli, RunResult } from "./dockerCli.ts";
import { obj } from "../shared/util.ts";

export type ComposeVars = Readonly<{
  port: number;
  token: string;
  agentImage: string;
  searchImage: string;
  dataVolume: string;
  keysVolume: string;
  resetCredentials?: boolean;
}>;
export type ProjectSpec = Readonly<{ project: string; stackDir: string; vars: ComposeVars }>;

export const SERVICES = ["agent", "search", "renderer"] as const;
export type ServiceName = (typeof SERVICES)[number];

export type ServiceState = Readonly<{
  service: string;
  id: string;
  name: string;
  state: string;
  health: string;
  exitCode: number;
  image: string;
}>;

export type ContainerInspect = Readonly<{
  id: string;
  service: string;
  image: string;
  imageId: string;
  configFiles?: string;
  workingDir?: string;
  status: string;
  exitCode: number;
  health?: string;
  restartCount: number;
  startedAt?: string;
  created?: string;
  token?: string;
  port?: number;
  version?: string;
  dataVolume?: string;
  keysVolume?: string;
}>;

export type ComposeRun = Readonly<{ signal?: AbortSignal; onLine?: (l: string) => void }>;

export interface Compose {
  readonly spec: ProjectSpec;
  ps(): Promise<ServiceState[] | undefined>;
  inspect(ids: readonly string[]): Promise<ContainerInspect[]>;
  up(o: { forceRecreate: boolean } & ComposeRun): Promise<RunResult>;
  start(o?: ComposeRun): Promise<RunResult>;
  stop(service?: "agent", o?: ComposeRun): Promise<RunResult>;
  down(o: { volumes: boolean } & ComposeRun): Promise<RunResult>;
  logs(o: { services: readonly string[]; tail: number; timestamps: boolean }): Promise<string>;
  port(): Promise<string | undefined>;
}

export const composeFile = (stackDir: string) => join(stackDir, "docker-compose.yml");

export function composeArgs(p: Pick<ProjectSpec, "project" | "stackDir">, sub: readonly string[]): string[] {
  return [
    "compose",
    "-p",
    p.project,
    "-f",
    composeFile(p.stackDir),
    "--project-directory",
    p.stackDir,
    "--env-file",
    "/dev/null",
    "--ansi",
    "never",
    ...sub,
  ];
}

export const UP_ARGS = (forceRecreate: boolean) => [
  "up",
  "-d",
  "--no-build",
  "--pull",
  "never",
  ...(forceRecreate ? ["--force-recreate"] : []),
  "--remove-orphans",
];

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function psRow(v: unknown): ServiceState | undefined {
  const r = obj(v);
  if (!r) return undefined;
  const service = str(r.Service);
  if (!service) return undefined;
  return {
    service,
    id: str(r.ID),
    name: str(r.Name) || str(r.Names),
    state: str(r.State),
    health: str(r.Health),
    exitCode: num(r.ExitCode),
    image: str(r.Image),
  };
}

export function parsePs(stdout: string): ServiceState[] | undefined {
  const text = stdout.trim();
  if (text === "") return [];
  try {
    if (text.startsWith("[")) {
      const arr: unknown = JSON.parse(text);
      if (!Array.isArray(arr)) return undefined;
      return arr.map(psRow).filter((r): r is ServiceState => r !== undefined);
    }
    return text
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => psRow(JSON.parse(l)))
      .filter((r): r is ServiceState => r !== undefined);
  } catch {
    return undefined;
  }
}

const envValue = (env: unknown, name: string): string | undefined => {
  if (!Array.isArray(env)) return undefined;
  const prefix = `${name}=`;
  const hit = env.find((e): e is string => typeof e === "string" && e.startsWith(prefix));
  return hit === undefined ? undefined : hit.slice(prefix.length);
};

function inspectRow(v: unknown): ContainerInspect | undefined {
  const r = obj(v);
  const config = obj(r?.Config);
  const state = obj(r?.State);
  if (!r || !config || !state) return undefined;
  const labels = obj(config.Labels) ?? {};
  const port = Number(envValue(config.Env, "OPEN_AGENT_PORT"));
  const mounts = Array.isArray(r.Mounts) ? r.Mounts.map(obj).filter((m) => m !== undefined) : [];
  const volumeAt = (dest: string) => {
    const m = mounts.find((x) => x?.Destination === dest && x?.Type === "volume");
    return m ? str(m.Name) || undefined : undefined;
  };
  return {
    id: str(r.Id),
    service: str(labels["com.docker.compose.service"]),
    image: str(config.Image),
    imageId: str(r.Image),
    configFiles: str(labels["com.docker.compose.project.config_files"]) || undefined,
    workingDir: str(labels["com.docker.compose.project.working_dir"]) || undefined,
    status: str(state.Status),
    exitCode: num(state.ExitCode),
    health: str(obj(state.Health)?.Status) || undefined,
    restartCount: num(r.RestartCount),
    startedAt: str(state.StartedAt) || undefined,
    created: str(r.Created) || undefined,
    token: envValue(config.Env, "OPEN_AGENT_LAUNCH_TOKEN") || undefined,
    port: Number.isInteger(port) && port > 0 ? port : undefined,
    version: str(labels["org.opencontainers.image.version"]) || undefined,
    dataVolume: volumeAt("/data"),
    keysVolume: volumeAt("/keys"),
  };
}

export function parseInspect(stdout: string): ContainerInspect[] {
  try {
    const arr: unknown = JSON.parse(stdout);
    if (!Array.isArray(arr)) return [];
    return arr.map(inspectRow).filter((r): r is ContainerInspect => r !== undefined);
  } catch {
    return [];
  }
}

export const TIMEOUTS = Object.freeze({ quick: 15_000, up: 15 * 60_000, stop: 30_000, down: 120_000, logs: 15_000 });

export function createCompose(cli: DockerCli, spec: ProjectSpec, envFor: (vars?: ComposeVars) => Record<string, string>): Compose {
  const env = envFor(spec.vars);
  const run = (sub: readonly string[], timeoutMs: number, o: ComposeRun & { quiet?: boolean } = {}) =>
    cli.run(composeArgs(spec, sub), { env, timeoutMs, signal: o.signal, onStdoutLine: o.onLine, onStderrLine: o.onLine, quiet: o.quiet });
  return {
    spec,
    ps: async () => {
      const r = await run(["ps", "-a", "--format", "json"], TIMEOUTS.quick, { quiet: true });
      return r.code === 0 ? parsePs(r.stdout) : undefined;
    },
    inspect: async (ids) => {
      if (ids.length === 0) return [];
      const r = await cli.run(["inspect", ...ids], { env: envFor(), timeoutMs: TIMEOUTS.quick, quiet: true });
      return r.code === 0 ? parseInspect(r.stdout) : [];
    },
    up: (o) => run(UP_ARGS(o.forceRecreate), TIMEOUTS.up, o),
    start: (o) => run(["start"], TIMEOUTS.up, o),
    stop: (service, o) => run(service ? ["stop", service] : ["stop"], TIMEOUTS.stop, o),
    down: (o) => run(o.volumes ? ["down", "-v", "--remove-orphans"] : ["down", "--remove-orphans"], TIMEOUTS.down, o),
    logs: async (o) => {
      const r = await run(
        ["logs", "--no-color", ...(o.timestamps ? ["--timestamps"] : []), "--tail", String(o.tail), ...o.services],
        TIMEOUTS.logs,
      );
      return `${r.stdout}${r.stderr}`;
    },
    port: async () => {
      const r = await run(["port", "agent", "3000"], TIMEOUTS.quick);
      return r.code === 0 ? r.stdout.trim() : undefined;
    },
  };
}

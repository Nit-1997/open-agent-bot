import { homedir } from "node:os";
import { isAbsolute, join, normalize, relative } from "node:path";

export const OVERRIDE_VARS = [
  "OPEN_AGENT_SHELL_STATE_DIR",
  "OPEN_AGENT_SHELL_DOCKER",
  "OPEN_AGENT_SHELL_PROJECT",
  "OPEN_AGENT_SHELL_DATA_VOLUME",
  "OPEN_AGENT_SHELL_KEYS_VOLUME",
  "OPEN_AGENT_SHELL_PORT_RANGE",
  "OPEN_AGENT_SHELL_SERVICES",
  "OPEN_AGENT_SHELL_RELEASES_URL",
  "OPEN_AGENT_SHELL_EXTERNAL_LOG",
  "OPEN_AGENT_SHELL_SAVE_PATH",
  "OPEN_AGENT_SHELL_SINGLE_INSTANCE_ID",
  "OPEN_AGENT_SHELL_ALLOW_SYSTEM_SOCKET",
  "OPEN_AGENT_SHELL_FAKE_LOCATION",
  "OPEN_AGENT_SHELL_EXTERNAL_WINDOW_MS",
  "OPEN_AGENT_SHELL_FAKE_APPS",
] as const;

export const PRODUCTION = Object.freeze({
  project: "open-agent",
  dataVolume: "open-agent-data",
  keysVolume: "open-agent-keys",
  portRange: [41100, 41199] as const,
  releasesUrl: "https://api.github.com/repos/Nit-1997/open-agent-bot/releases/latest",
});

export type ShellConfig = Readonly<{
  test: boolean;
  project: string;
  dataVolume: string;
  keysVolume: string;
  portRange: readonly [number, number];
  releasesUrl?: string;
  dockerOverride?: string;
  servicesOverride?: string;
  externalLog?: string;
  savePath?: string;
  stateDir?: string;
  singleInstanceId?: string;
  allowSystemSocket: boolean;
  fakeOutside: boolean;
  externalWindowMs?: number;
  fakeApps?: Readonly<{ dockerDesktop: boolean; orbstack: boolean }>;
  ignored: readonly string[];
}>;

export class ShellConfigError extends Error {
  constructor(
    readonly variable: string,
    message: string,
  ) {
    super(`${variable}: ${message}`);
    this.name = "ShellConfigError";
  }
}

const TEST_NAME = /^oab-[a-z0-9][a-z0-9-]{0,58}$/;
const TEST_PORT_MIN = 18000;
const TEST_PORT_MAX = 19999;

const within = (parent: string, child: string) => {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

function realDefaults() {
  const home = homedir();
  return { realUserData: join(home, "Library/Application Support/Open Agent"), realLogs: join(home, "Library/Logs/Open Agent") };
}

export function loadShellConfig(env: NodeJS.ProcessEnv, real: { realUserData: string; realLogs: string } = realDefaults()): ShellConfig {
  const flag = env.OPEN_AGENT_SHELL_TEST;
  if (flag !== undefined && flag !== "" && flag !== "1") throw new ShellConfigError("OPEN_AGENT_SHELL_TEST", "must be 1 or unset");
  if (flag !== "1") {
    return {
      test: false,
      ...PRODUCTION,
      allowSystemSocket: false,
      fakeOutside: false,
      ignored: OVERRIDE_VARS.filter((name) => env[name] !== undefined),
    };
  }

  const get = (name: (typeof OVERRIDE_VARS)[number]) => {
    const v = env[name];
    return v === undefined || v === "" ? undefined : v;
  };
  const required = (name: (typeof OVERRIDE_VARS)[number]) => {
    const v = get(name);
    if (v === undefined) throw new ShellConfigError(name, "is required in test mode");
    return v;
  };
  const absolute = (name: (typeof OVERRIDE_VARS)[number]) => {
    const v = get(name);
    if (v === undefined) return undefined;
    if (!isAbsolute(v) || v.includes("\0")) throw new ShellConfigError(name, "must be an absolute path");
    return normalize(v);
  };
  const testName = (name: (typeof OVERRIDE_VARS)[number]) => {
    const v = required(name);
    if (!TEST_NAME.test(v)) throw new ShellConfigError(name, "must match ^oab-[a-z0-9-]+$ in test mode");
    return v;
  };
  const testPort = (name: (typeof OVERRIDE_VARS)[number], raw: string) => {
    if (!/^\d{5}$/.test(raw)) throw new ShellConfigError(name, "must be a port in 18000-19999");
    const n = Number(raw);
    if (n < TEST_PORT_MIN || n > TEST_PORT_MAX) throw new ShellConfigError(name, "must be inside 18000-19999");
    return n;
  };

  const stateDir = absolute("OPEN_AGENT_SHELL_STATE_DIR");
  if (!stateDir) throw new ShellConfigError("OPEN_AGENT_SHELL_STATE_DIR", "is required in test mode");
  if (within(real.realUserData, stateDir) || within(real.realLogs, stateDir))
    throw new ShellConfigError("OPEN_AGENT_SHELL_STATE_DIR", "must not be the real Open Agent profile or logs");

  const project = testName("OPEN_AGENT_SHELL_PROJECT");
  const dataVolume = testName("OPEN_AGENT_SHELL_DATA_VOLUME");
  const keysVolume = testName("OPEN_AGENT_SHELL_KEYS_VOLUME");
  if (dataVolume === keysVolume) throw new ShellConfigError("OPEN_AGENT_SHELL_KEYS_VOLUME", "must differ from the data volume");

  const range = /^(\d+)-(\d+)$/.exec(required("OPEN_AGENT_SHELL_PORT_RANGE"));
  if (!range) throw new ShellConfigError("OPEN_AGENT_SHELL_PORT_RANGE", "must be a-b");
  const lo = testPort("OPEN_AGENT_SHELL_PORT_RANGE", range[1] ?? "");
  const hi = testPort("OPEN_AGENT_SHELL_PORT_RANGE", range[2] ?? "");
  if (lo > hi) throw new ShellConfigError("OPEN_AGENT_SHELL_PORT_RANGE", "must be ascending");

  const releasesUrl = get("OPEN_AGENT_SHELL_RELEASES_URL");
  if (releasesUrl !== undefined) {
    let u: URL;
    try {
      u = new URL(releasesUrl);
    } catch {
      throw new ShellConfigError("OPEN_AGENT_SHELL_RELEASES_URL", "must be a URL");
    }
    if (u.protocol !== "http:" || u.hostname !== "127.0.0.1" || u.username || u.password || !/^18\d{3}$/.test(u.port))
      throw new ShellConfigError("OPEN_AGENT_SHELL_RELEASES_URL", "must be http://127.0.0.1:18xxx/...");
  }

  const singleInstanceId = get("OPEN_AGENT_SHELL_SINGLE_INSTANCE_ID");
  if (singleInstanceId !== undefined && !/^[a-z0-9-]{1,40}$/.test(singleInstanceId))
    throw new ShellConfigError("OPEN_AGENT_SHELL_SINGLE_INSTANCE_ID", "must match ^[a-z0-9-]{1,40}$");

  const socket = get("OPEN_AGENT_SHELL_ALLOW_SYSTEM_SOCKET");
  if (socket !== undefined && socket !== "1") throw new ShellConfigError("OPEN_AGENT_SHELL_ALLOW_SYSTEM_SOCKET", "must be 1 or unset");

  const location = get("OPEN_AGENT_SHELL_FAKE_LOCATION");
  if (location !== undefined && location !== "outside")
    throw new ShellConfigError("OPEN_AGENT_SHELL_FAKE_LOCATION", "must be outside or unset");

  const externalWindow = get("OPEN_AGENT_SHELL_EXTERNAL_WINDOW_MS");
  if (externalWindow !== undefined && (!/^\d{1,5}$/.test(externalWindow) || Number(externalWindow) > 60_000))
    throw new ShellConfigError("OPEN_AGENT_SHELL_EXTERNAL_WINDOW_MS", "must be a whole number of ms in 0-60000");

  const apps = (get("OPEN_AGENT_SHELL_FAKE_APPS") ?? "").split(",").filter(Boolean);
  if (apps.some((a) => a !== "docker-desktop" && a !== "orbstack"))
    throw new ShellConfigError("OPEN_AGENT_SHELL_FAKE_APPS", "must list docker-desktop and/or orbstack");

  return {
    test: true,
    stateDir,
    project,
    dataVolume,
    keysVolume,
    portRange: [lo, hi],
    releasesUrl,
    dockerOverride: absolute("OPEN_AGENT_SHELL_DOCKER"),
    servicesOverride: absolute("OPEN_AGENT_SHELL_SERVICES"),
    externalLog: absolute("OPEN_AGENT_SHELL_EXTERNAL_LOG"),
    savePath: absolute("OPEN_AGENT_SHELL_SAVE_PATH"),
    singleInstanceId,
    allowSystemSocket: socket === "1",
    fakeOutside: location === "outside",
    ...(externalWindow !== undefined ? { externalWindowMs: Number(externalWindow) } : {}),
    fakeApps: { dockerDesktop: apps.includes("docker-desktop"), orbstack: apps.includes("orbstack") },
    ignored: [],
  };
}

export const windowTitle = (cfg: Pick<ShellConfig, "test">, localBuild?: string) =>
  `Open Agent${localBuild ? " — Local build" : ""}${cfg.test ? " — test" : ""}`;

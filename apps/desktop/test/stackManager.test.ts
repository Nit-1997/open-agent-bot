import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ShellState } from "../src/shared/actions.ts";
import type { Compose, ComposeRun, ContainerInspect, ProjectSpec } from "../src/main/compose.ts";
import type { DockerCli, DockerProbe, RunResult } from "../src/main/dockerCli.ts";
import type { Health } from "../src/main/health.ts";
import { tokenFingerprint } from "../src/main/launchToken.ts";
import { silentLog } from "../src/main/logger.ts";
import { createPortPicker } from "../src/main/portPicker.ts";
import type { ServicePins } from "../src/main/services.ts";
import { DEFAULT_SETTINGS, type Settings, type SettingsStore } from "../src/main/settings.ts";
import { loadShellConfig } from "../src/main/shellConfig.ts";
import { createStackManager, type ManagerDeps, type StackManager } from "../src/main/stackManager.ts";
import { resolvePaths, writeStateFile } from "../src/main/statePaths.ts";
import { buildZip } from "./fake-docker/zip.mjs";

const PROJECT = "oab-unit";
const PINS: ServicePins = {
  kind: "dev",
  version: "0.0.0-unit",
  composeSha256: "x",
  images: { agent: `127.0.0.1:18467/oab-a@sha256:${"a".repeat(64)}`, search: `127.0.0.1:18467/oab-s@sha256:${"b".repeat(64)}` },
  pull: true,
};
const ID_A = `sha256:${"1".repeat(64)}`;
const ID_S = `sha256:${"2".repeat(64)}`;

type UpBehaviour = "healthy" | { refuse: string; exit: number } | "noSpace" | "portTaken" | "slow" | "neverHealthy";
type World = {
  containers: ContainerInspect[];
  images: Record<string, string>;
  up: UpBehaviour;
  pull: "ok" | "noSpace" | "slow";
  portPrint?: string;
  calls: { kind: string; args: string[]; reset?: boolean; token?: string; force?: boolean }[];
  stopFails: boolean;
  volumeRmFails: boolean;
  dockerDown: boolean;
  exportMode: "ok" | "slow";
  versions: Record<string, string>;
};

let dir: string;
let world: World;
let managers: StackManager[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oab-mgr-"));
  world = {
    containers: [],
    images: {},
    up: "healthy",
    pull: "ok",
    calls: [],
    stopFails: false,
    volumeRmFails: false,
    dockerDown: false,
    exportMode: "ok",
    versions: {},
  };
  managers = [];
});
afterEach(async () => {
  for (const m of managers) await m.quit().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
});

const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "", ms: 1 });
const fail = (stderr: string, code = 1): RunResult => ({ code, stdout: "", stderr, ms: 1 });

const waitAbort = (signal?: AbortSignal) =>
  new Promise<RunResult>((resolve) => {
    if (signal?.aborted) return resolve({ code: null, signal: "aborted", stdout: "", stderr: "", ms: 1 });
    signal?.addEventListener("abort", () => resolve({ code: null, signal: "aborted", stdout: "", stderr: "", ms: 1 }), { once: true });
  });

const container = (service: string, o: Partial<ContainerInspect> = {}): ContainerInspect => ({
  id: `${service}-id`,
  service,
  image: service === "search" ? PINS.images.search : PINS.images.agent,
  imageId: service === "search" ? ID_S : ID_A,
  configFiles: join(dir, "stack/docker-compose.yml"),
  workingDir: join(dir, "stack"),
  status: "running",
  exitCode: 0,
  health: "healthy",
  restartCount: 0,
  version: "0.0.0-unit",
  ...o,
});

function stack(token: string, port: number, o: Partial<Record<string, Partial<ContainerInspect>>> = {}): ContainerInspect[] {
  return ["agent", "search", "renderer"].map((s) => container(s, { ...(s === "agent" ? { token, port } : {}), ...o[s] }));
}

function fakeCompose(spec: ProjectSpec): Compose {
  const rec = (kind: string, args: string[] = [], extra: Partial<World["calls"][number]> = {}) =>
    world.calls.push({ kind, args, token: spec.vars.token, reset: spec.vars.resetCredentials === true, ...extra });
  const agent = () => world.containers.find((c) => c.service === "agent");
  return {
    spec,
    ps: async () => {
      rec("ps");
      return world.containers.map((c) => ({
        service: c.service,
        id: c.id,
        name: c.service,
        state: c.status,
        health: c.health ?? "",
        exitCode: c.exitCode,
        image: c.image,
      }));
    },
    inspect: async (ids) => world.containers.filter((c) => ids.includes(c.id)),
    up: async (o: { forceRecreate: boolean } & ComposeRun) => {
      rec("up", [], { force: o.forceRecreate });
      const b = world.up;
      if (b === "noSpace") return fail("write /var/lib/docker: no space left on device");
      if (b === "portTaken") return fail("Bind for 127.0.0.1:18421 failed: port is already allocated");
      world.containers = stack(spec.vars.token, spec.vars.port, {
        agent: { image: spec.vars.agentImage },
        search: { image: spec.vars.searchImage },
        renderer: { image: spec.vars.agentImage },
      });
      if (b === "slow") {
        world.containers = world.containers.map((c) => ({ ...c, status: "created", health: "" }));
        return waitAbort(o.signal);
      }
      if (b === "neverHealthy") {
        world.containers = world.containers.map((c) => (c.service === "agent" ? { ...c, health: "starting" } : c));
        return ok();
      }
      if (typeof b === "object") {
        world.containers = world.containers.map((c) =>
          c.service === "agent" ? { ...c, status: "restarting", exitCode: b.exit, health: undefined } : c,
        );
        world.calls.push({ kind: "refusalLog", args: [b.refuse] });
        return waitAbort(o.signal);
      }
      return ok();
    },
    start: async () => {
      rec("start");
      world.containers = world.containers.map((c) => ({ ...c, status: "running", health: "healthy" }));
      return ok();
    },
    stop: async (service) => {
      rec("stop", service ? [service] : []);
      if (world.stopFails) return fail("timeout");
      world.containers = world.containers.map((c) => (!service || c.service === service ? { ...c, status: "exited" } : c));
      return ok();
    },
    down: async (o) => {
      rec("down", o.volumes ? ["-v"] : []);
      world.containers = [];
      return ok();
    },
    logs: async () => {
      const refusal = world.calls.filter((c) => c.kind === "refusalLog").at(-1)?.args[0];
      return refusal
        ? `agent-1  | [startup] refused code=${refusal} the database holds 2 saved model keys sealed with it`
        : "agent-1  | hello\n";
    },
    port: async () => {
      const a = agent();
      return a?.status === "running" ? (world.portPrint ?? `127.0.0.1:${a.port}`) : undefined;
    },
  };
}

const cli: DockerCli = {
  path: "/usr/local/bin/docker",
  run: async (args, o) => {
    const [a, b] = args;
    if (a === "image" && b === "inspect") {
      const ref = args.at(-1) ?? "";
      return world.images[ref] ? ok(world.images[ref]) : fail("No such image");
    }
    if (a === "manifest") return fail("not available");
    if (a === "pull") {
      world.calls.push({ kind: "pull", args: [...args] });
      if (world.pull === "noSpace") return fail("failed to register layer: no space left on device");
      if (world.pull === "slow") return waitAbort(o.signal);
      o.onStdoutLine?.("aaaaaaaaaaaa: Pulling fs layer");
      o.onStdoutLine?.("aaaaaaaaaaaa: Pull complete");
      o.onStdoutLine?.("Status: Downloaded newer image for x");
      const ref = args[1] ?? "";
      world.images[ref] = ref.includes("oab-s") ? ID_S : ID_A;
      return ok();
    }
    if (a === "run") {
      world.calls.push({ kind: "run", args: [...args] });
      const cmd = args[args.indexOf("dist/local/dataTools.js") + 1];
      if (cmd === "stats") return ok(JSON.stringify({ schema: 1, dbBytes: 2 * 1024 * 1024, reports: 1, chats: 4, reportBytes: 100 }));
      if (cmd === "check") return ok(JSON.stringify({ credentials: 0, schema: 1 }));
      if (cmd === "export" && world.exportMode === "slow") return waitAbort(o.signal);
      o.stdoutTo?.write(
        buildZip([
          { name: "export.json", data: Buffer.from("{}") },
          { name: "open-agent.db", data: Buffer.from("SQLite format 3") },
        ]),
      );
      return ok();
    }
    if (a === "volume") {
      world.calls.push({ kind: "volumeRm", args: [...args] });
      return world.volumeRmFails ? fail("volume is in use") : ok();
    }
    return ok();
  },
};

const health = (port: number): Health | undefined => {
  const a = world.containers.find((c) => c.service === "agent");
  return a && a.status === "running" && a.port === port && a.health === "healthy"
    ? { ok: true, app: "open-agent", version: world.versions[a.image] ?? "0.0.0-unit" }
    : undefined;
};

function memorySettings(initial: Partial<Settings> = {}): SettingsStore & { writes: Settings[] } {
  let cur: Settings = { ...DEFAULT_SETTINGS, ...initial };
  const writes: Settings[] = [];
  return {
    writes,
    get: () => cur,
    update: (patch, drop = []) => {
      const next: Record<string, unknown> = { ...cur, ...patch };
      for (const k of drop) delete next[k];
      cur = next as Settings;
      writes.push(cur);
      return cur;
    },
  };
}

type Built = {
  m: StackManager;
  views: string[];
  tokens: { current?: string; previous?: string };
  states: ShellState[];
  settings: ReturnType<typeof memorySettings>;
};

function build(
  o: {
    pins?: ServicePins;
    settings?: Partial<Settings>;
    busy?: number[];
    probe?: DockerProbe;
    cfgEnv?: Record<string, string>;
    savePath?: string;
    log?: ManagerDeps["log"];
    updates?: ManagerDeps["updates"];
  } = {},
): Built {
  const cfg = loadShellConfig({
    OPEN_AGENT_SHELL_TEST: "1",
    OPEN_AGENT_SHELL_STATE_DIR: dir,
    OPEN_AGENT_SHELL_PROJECT: PROJECT,
    OPEN_AGENT_SHELL_DATA_VOLUME: `${PROJECT}-data`,
    OPEN_AGENT_SHELL_KEYS_VOLUME: `${PROJECT}-keys`,
    OPEN_AGENT_SHELL_PORT_RANGE: "18421-18423",
    ...o.cfgEnv,
  });
  const paths = resolvePaths(cfg, { userData: join(dir, "electron"), logs: join(dir, "logs") });
  const views: string[] = [];
  const tokens: { current?: string; previous?: string } = {};
  const settings = memorySettings(o.settings);
  const busy = new Set(o.busy ?? []);
  const probe: DockerProbe = o.probe ?? {
    kind: "ok",
    client: "29",
    server: "29",
    compose: "5.1.1",
    context: "desktop-linux",
    engine: "docker-desktop",
    arch: "arm64",
  };
  const deps: ManagerDeps = {
    cfg,
    paths,
    log: o.log ?? silentLog,
    settings,
    tokens,
    stage: () => ({ sha256: "s".repeat(64), restaged: false }),
    pins: () => ({ ok: true, pins: o.pins ?? PINS }),
    locate: () => ({ kind: "found", path: cli.path, searched: [cli.path], rejected: [] }),
    pluginsProblem: () => undefined,
    makeCli: () => cli,
    envFor: () => ({}),
    endpoint: async () => ({ ok: true, endpoint: "unix:///x.sock", socket: "/x.sock", owner: 501 }),
    probe: async () => (world.dockerDown ? { kind: "stopped", client: "29", stderrTail: "Cannot connect" } : probe),
    compose: (_c, spec) => fakeCompose(spec),
    http: { get: async (port) => health(port) },
    ports: createPortPicker(async (p) => !busy.has(p) && !world.containers.some((c) => c.port === p && c.status === "running")),
    view: {
      open: async (port, token) => {
        views.push(`open ${port} ${tokenFingerprint(token)}`);
      },
      close: async () => {
        views.push("close");
      },
      reload: () => views.push("reload"),
    },
    apps: () => ({ dockerDesktop: true, orbstack: false }),
    needsMove: () => false,
    moveToApplications: () => {},
    openApp: () => {},
    relaunch: () => {},
    ...(o.updates ? { updates: o.updates } : {}),
    savePath: async () => o.savePath ?? join(dir, "saved.zip"),
    freeBytes: () => 50 * 1024 ** 3,
    timings: {
      pollMs: 5,
      healthTimeoutMs: 400,
      dockerPollMs: 10,
      watchdogMs: 60_000,
      healthGetMs: 50,
      deleteWaitMs: 500,
      settleMs: 30,
      servicesPollMs: 20,
    },
  };
  const m = createStackManager(deps);
  managers.push(m);
  const states: ShellState[] = [];
  m.on((s) => states.push(s));
  return { m, views, tokens, states, settings };
}

const kinds = () => world.calls.map((c) => c.kind).filter((k) => k !== "ps" && k !== "refusalLog");
const mutations = () => kinds().filter((k) => ["up", "start", "stop", "down", "pull", "volumeRm"].includes(k));
const storedToken = () => JSON.parse(readFileSync(join(dir, "stack.json"), "utf8")).launchToken as string;
const seedStack = (token: string, port: number) =>
  writeStateFile(join(dir, "stack.json"), { schema: 1, project: PROJECT, port, launchToken: token, tokenCreatedAt: "t" });
const until = async (f: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe("stackManager phases (D10)", () => {
  it("fresh start: pull both images, one up (no recreate) with a new token, port check, then the app", async () => {
    const b = build();
    await b.m.boot();
    await b.m.idle();
    expect(b.m.state()).toMatchObject({ phase: "ready", screen: "app", port: 18421 });
    expect(mutations()).toEqual(["pull", "pull", "up"]);
    const up = world.calls.find((c) => c.kind === "up");
    expect(up?.force).toBe(false);
    expect(up?.token).toBe(storedToken());
    expect(b.views).toEqual([`open 18421 ${tokenFingerprint(storedToken())}`]);
    expect(b.states.map((s) => s.phase)).toEqual(
      expect.arrayContaining(["checkingDocker", "inspecting", "portCheck", "pulling", "creating", "waitingHealth", "ready"]),
    );
  });

  it("attach: a running stack of ours with the stored token gets no mutation call", async () => {
    const token = "c".repeat(64);
    seedStack(token, 18422);
    world.containers = stack(token, 18422);
    world.images = { [PINS.images.agent]: ID_A, [PINS.images.search]: ID_S };
    const b = build();
    await b.m.boot();
    await b.m.idle();
    expect(b.m.state().screen).toBe("app");
    expect(mutations()).toEqual([]);
    expect(b.views).toEqual([`open 18422 ${tokenFingerprint(token)}`]);
  });

  it("resume: a stopped stack of ours → compose start only, the same token", async () => {
    const token = "c".repeat(64);
    seedStack(token, 18422);
    world.containers = stack(token, 18422, {
      agent: { status: "exited" },
      search: { status: "exited" },
      renderer: { status: "exited", exitCode: 143 },
    });
    world.images = { [PINS.images.agent]: ID_A, [PINS.images.search]: ID_S };
    const b = build();
    await b.m.boot();
    await b.m.idle();
    expect(mutations()).toEqual(["start"]);
    expect(storedToken()).toBe(token);
    expect(b.m.state().screen).toBe("app");
  });

  it("stale (token mismatch): up --force-recreate with a rotated token", async () => {
    seedStack("c".repeat(64), 18422);
    world.containers = stack("d".repeat(64), 18422);
    world.images = { [PINS.images.agent]: ID_A, [PINS.images.search]: ID_S };
    const b = build();
    await b.m.boot();
    await b.m.idle();
    expect(mutations()).toEqual(["up"]);
    expect(world.calls.find((c) => c.kind === "up")?.force).toBe(true);
    expect(storedToken()).not.toBe("c".repeat(64));
    expect(b.tokens.previous).toBe("c".repeat(64));
    expect(b.m.state().screen).toBe("app");
  });

  it("foreign: no mutation until useAppStack, then up --force-recreate with a new token", async () => {
    world.containers = stack("e".repeat(64), 18468).map((c) => ({ ...c, configFiles: "/repo/docker-compose.yml", workingDir: "/repo" }));
    const b = build();
    await b.m.boot();
    await b.m.idle();
    expect(b.m.state()).toMatchObject({ screen: "screen-foreign-stack", foreign: { workingDir: "/repo", port: 18468 } });
    expect(mutations()).toEqual([]);
    expect(await b.m.act({ type: "useAppStack" })).toEqual({ ok: true });
    await b.m.idle();
    expect(mutations()).toEqual(["pull", "pull", "up"]);
    expect(b.m.state().screen).toBe("app");
  });

  it("a refusal → compose stop agent at once → the refusal screen with the line and count", async () => {
    world.up = { refuse: "kek_missing", exit: 82 };
    const b = build();
    await b.m.boot();
    await b.m.idle();
    expect(b.m.state()).toMatchObject({
      phase: "refused",
      screen: "screen-refusal-kek_missing",
      refusal: { code: "kek_missing", exitCode: 82, count: 2 },
    });
    expect(world.calls.filter((c) => c.kind === "stop").map((c) => c.args)).toEqual([["agent"]]);
    expect(b.views).not.toContain(expect.stringMatching(/^open/));
  });

  it("reset: confirm gate, then exactly one up with RESET=1 and a rotated token; later ups pass it empty", async () => {
    world.up = { refuse: "kek_missing", exit: 82 };
    const b = build();
    await b.m.boot();
    await b.m.idle();
    expect(await b.m.act({ type: "resetCredentials", confirm: "reset" })).toEqual({ ok: false, error: "not_confirming" });
    expect(await b.m.act({ type: "confirmReset" })).toEqual({ ok: true });
    expect(b.m.state()).toMatchObject({ screen: "screen-confirm-reset", confirm: { count: 2 } });
    world.up = "healthy";
    const before = storedToken();
    expect(await b.m.act({ type: "resetCredentials", confirm: "reset" })).toEqual({ ok: true });
    await b.m.idle();
    expect(b.m.state().screen).toBe("app");
    const ups = world.calls.filter((c) => c.kind === "up");
    expect(ups.map((u) => u.reset)).toEqual([false, true]);
    expect(storedToken()).not.toBe(before);
    await b.m.act({ type: "restartServices" });
    await b.m.idle();
    expect(world.calls.filter((c) => c.kind === "up").map((u) => u.reset)).toEqual([false, true, false]);
  });

  it("port conflict → Pick another port → the next free port is persisted and used", async () => {
    seedStack("c".repeat(64), 18421);
    const b = build({ busy: [18421] });
    await b.m.boot();
    await b.m.idle();
    expect(b.m.state()).toMatchObject({ screen: "screen-port-conflict", conflict: { port: 18421 } });
    expect(mutations()).toEqual([]);
    await b.m.act({ type: "pickAnotherPort" });
    await b.m.idle();
    expect(b.m.state()).toMatchObject({ screen: "app", port: 18422 });
    expect(JSON.parse(readFileSync(join(dir, "stack.json"), "utf8")).port).toBe(18422);
  });

  it("compose's 'port is already allocated' maps to the same conflict screen", async () => {
    world.up = "portTaken";
    const b = build();
    await b.m.boot();
    await b.m.idle();
    expect(b.m.state().screen).toBe("screen-port-conflict");
  });

  it("health timeout → failed{step:health} with the agent log tail", async () => {
    world.up = "neverHealthy";
    const b = build();
    await b.m.boot();
    await b.m.idle();
    expect(b.m.state()).toMatchObject({
      screen: "screen-failed",
      failure: { reason: "health_timeout", step: "health", tail: "agent-1  | hello" },
    });
  });

  it("a port mismatch (compose port prints 0.0.0.0:<port>) → no cookie, failed port_mismatch", async () => {
    world.portPrint = "0.0.0.0:18421";
    const b = build();
    await b.m.boot();
    await b.m.idle();
    expect(b.m.state()).toMatchObject({ screen: "screen-failed", failure: { reason: "port_mismatch" } });
    expect(b.views).toEqual([]);
  });

  it("a local lock whose image Id changed → local_images_changed with zero compose calls", async () => {
    const local: ServicePins = {
      ...PINS,
      kind: "local",
      version: "local-abc",
      images: { agent: "open-agent:local", search: "open-agent-search:local" },
      imageIds: { agent: ID_A, search: ID_S },
      pull: false,
    };
    world.images = { "open-agent:local": `sha256:${"9".repeat(64)}`, "open-agent-search:local": ID_S };
    const b = build({ pins: local });
    await b.m.boot();
    await b.m.idle();
    expect(b.m.state()).toMatchObject({
      screen: "screen-failed",
      failure: { reason: "local_images_changed" },
      localBuild: "Local build (local-abc)",
    });
    expect(world.calls.filter((c) => c.kind !== "pull")).toEqual([]);
  });

  it("disk full from pull and from up → screen-disk-full (docker) with the engine line", async () => {
    world.pull = "noSpace";
    const b = build();
    await b.m.boot();
    await b.m.idle();
    expect(b.m.state()).toMatchObject({ screen: "screen-disk-full", disk: { where: "docker", engine: "Docker Desktop" } });
    world.pull = "ok";
    world.up = "noSpace";
    await b.m.act({ type: "retry" });
    await b.m.idle();
    expect(b.m.state()).toMatchObject({ screen: "screen-disk-full", disk: { where: "docker" } });
    expect(b.m.state().disk?.line).toContain("Disk usage limit");
  });

  it("Docker stopped → polls and continues by itself", async () => {
    world.dockerDown = true;
    const b = build();
    await b.m.boot();
    await b.m.idle();
    expect(b.m.state().screen).toBe("screen-docker-stopped");
    world.dockerDown = false;
    await until(() => b.m.state().screen === "app");
  });

  it("cancelPull → Download stopped with Retry", async () => {
    world.pull = "slow";
    const b = build();
    void b.m.boot();
    await until(() => b.m.state().phase === "pulling");
    expect(await b.m.act({ type: "cancelPull" })).toEqual({ ok: true });
    await b.m.idle();
    expect(b.m.state()).toMatchObject({ screen: "screen-failed", failure: { reason: "cancelled", step: "pull" } });
  });
});

describe("quit (D10 stop-on-quit, D20)", () => {
  it("stop-on-quit on → compose stop; off → nothing", async () => {
    const b = build();
    await b.m.boot();
    await b.m.idle();
    expect(await b.m.quit()).toEqual({ kind: "done" });
    expect(kinds().at(-1)).toBe("stop");
    world.calls = [];
    world.containers = [];
    const c = build({ settings: { stopOnQuit: false } });
    await c.m.boot();
    await c.m.idle();
    world.calls = [];
    await c.m.quit();
    expect(mutations()).toEqual([]);
  });

  it("a stop failure still quits", async () => {
    const b = build();
    await b.m.boot();
    await b.m.idle();
    world.stopFails = true;
    expect(await b.m.quit()).toEqual({ kind: "done" });
  });

  it("quit during a pull aborts it; no up is called", async () => {
    world.pull = "slow";
    const b = build();
    void b.m.boot();
    await until(() => b.m.state().phase === "pulling");
    await b.m.quit();
    expect(mutations()).toEqual(["pull"]);
  });

  it("quit during up aborts it, then compose stop whatever the setting", async () => {
    world.up = "slow";
    const b = build({ settings: { stopOnQuit: false } });
    void b.m.boot();
    await until(() => world.calls.some((c) => c.kind === "up"));
    await b.m.quit();
    expect(mutations()).toEqual(["pull", "pull", "up", "stop"]);
  });

  it("delete writes pendingDelete before down -v, clears it after both steps, then starts fresh", async () => {
    const b = build();
    await b.m.boot();
    await b.m.idle();
    expect(await b.m.act({ type: "deleteData", confirm: "delete" })).toEqual({ ok: false, error: "not_confirming" });
    await b.m.act({ type: "confirmDelete" });
    expect(b.m.state().screen).toBe("screen-confirm-delete");
    world.calls = [];
    await b.m.act({ type: "deleteData", confirm: "delete" });
    await b.m.idle();
    const pendingAt = b.settings.writes.findIndex((w) => w.pendingDelete);
    expect(pendingAt).toBeGreaterThanOrEqual(0);
    expect(b.settings.writes[pendingAt]?.pendingDelete).toMatchObject({
      project: PROJECT,
      dataVolume: `${PROJECT}-data`,
      keysVolume: `${PROJECT}-keys`,
    });
    expect(kinds().slice(0, 2)).toEqual(["down", "volumeRm"]);
    expect(world.calls.find((c) => c.kind === "down")?.args).toEqual(["-v"]);
    expect(b.settings.get().pendingDelete).toBeUndefined();
    expect(b.m.state().screen).toBe("app");
  });

  it("a failed volume rm keeps pendingDelete; the next boot finishes it when the names match", async () => {
    const b = build();
    await b.m.boot();
    await b.m.idle();
    world.volumeRmFails = true;
    await b.m.act({ type: "confirmDelete" });
    await b.m.act({ type: "deleteData", confirm: "delete" });
    await b.m.idle();
    expect(b.m.state()).toMatchObject({ screen: "screen-failed", failure: { reason: "delete_failed" } });
    const pending = b.settings.get().pendingDelete;
    expect(pending).toBeDefined();
    world.volumeRmFails = false;
    world.calls = [];
    const next = build({ settings: { pendingDelete: pending } });
    await next.m.boot();
    await next.m.idle();
    expect(kinds().slice(0, 2)).toEqual(["down", "volumeRm"]);
    expect(next.settings.get().pendingDelete).toBeUndefined();
    expect(next.m.state().screen).toBe("app");
  });

  it("a pendingDelete for other names deletes nothing and offers Discard", async () => {
    const b = build({
      settings: { pendingDelete: { project: PROJECT, dataVolume: "oab-other-data", keysVolume: `${PROJECT}-keys`, at: "t" } },
    });
    await b.m.boot();
    await b.m.idle();
    expect(b.m.state()).toMatchObject({ screen: "screen-failed", failure: { reason: "pending_delete_mismatch" } });
    expect(world.calls).toEqual([]);
    await b.m.act({ type: "discardPendingDelete" });
    await b.m.idle();
    expect(b.settings.get().pendingDelete).toBeUndefined();
    expect(b.m.state().screen).toBe("app");
  });

  it("quit during delete waits for it to finish", async () => {
    const b = build();
    await b.m.boot();
    await b.m.idle();
    await b.m.act({ type: "confirmDelete" });
    await b.m.act({ type: "deleteData", confirm: "delete" });
    expect(await b.m.quit()).toEqual({ kind: "done" });
    expect(b.settings.get().pendingDelete).toBeUndefined();
  });
});

describe("after ready", () => {
  it("launch mismatch → failed launch_mismatch → Restart services recreates with a new token", async () => {
    const b = build();
    await b.m.boot();
    await b.m.idle();
    const first = storedToken();
    b.m.launchMismatch();
    await b.m.idle();
    expect(b.m.state()).toMatchObject({ screen: "screen-failed", failure: { reason: "launch_mismatch" } });
    expect(b.views.at(-1)).toBe("close");
    await b.m.act({ type: "restartServices" });
    await b.m.idle();
    expect(b.m.state().screen).toBe("app");
    expect(storedToken()).not.toBe(first);
    expect(world.calls.filter((c) => c.kind === "up").at(-1)?.force).toBe(true);
  });

  it("ui crash → failed ui_crashed → Reload re-runs the port check and opens the app", async () => {
    const b = build();
    await b.m.boot();
    await b.m.idle();
    b.m.uiCrashed();
    expect(b.m.state()).toMatchObject({ screen: "screen-failed", failure: { reason: "ui_crashed" } });
    await b.m.act({ type: "retry" });
    await b.m.idle();
    expect(b.m.state().screen).toBe("app");
    expect(mutations().filter((k) => k === "up")).toHaveLength(1);
  });

  it("an internal error shows once per 10 s", () => {
    const b = build();
    b.m.internalError();
    expect(b.m.state()).toMatchObject({ screen: "screen-failed", failure: { reason: "internal_error" } });
    const n = b.states.length;
    b.m.internalError();
    expect(b.states.length).toBe(n);
  });
});

describe("Services & data (4.3)", () => {
  const readyApp = async () => {
    const b = build();
    await b.m.boot();
    await b.m.idle();
    expect(b.m.state().screen).toBe("app");
    return b;
  };

  it("opens over the app, polls the rows and reads the stats; Close returns to the app without a reload or a mutation", async () => {
    const b = await readyApp();
    world.calls = [];
    const views = b.views.length;
    b.m.openServices();
    expect(b.m.state().screen).toBe("screen-services");
    await until(() => b.m.state().servicesInfo?.data !== undefined);
    expect(b.m.state().servicesInfo?.rows.map((r) => `${r.service}=${r.state}=${r.version}`)).toEqual([
      "agent=running · healthy=0.0.0-unit",
      "search=running · healthy=0.0.0-unit",
      "renderer=running · healthy=0.0.0-unit",
    ]);
    expect(b.m.state().servicesInfo?.data).toEqual({ volume: `${PROJECT}-data`, dbBytes: 2 * 1024 * 1024, reports: 1, chats: 4 });
    const polls = world.calls.filter((c) => c.kind === "ps").length;
    await until(() => world.calls.filter((c) => c.kind === "ps").length > polls + 1);
    expect(await b.m.act({ type: "closeServices" })).toEqual({ ok: true });
    expect(b.m.state().screen).toBe("app");
    expect(b.views.length).toBe(views);
    expect(mutations()).toEqual([]);
    const stats = world.calls.find((c) => c.kind === "run");
    expect(stats?.args.slice(0, 5)).toEqual(["run", "--rm", "-i", "--network", "none"]);
    expect(stats?.args).toContain(`${PROJECT}-data:/data`);
    expect(stats?.args.join(" ")).not.toContain("/keys");
    const after = world.calls.filter((c) => c.kind === "ps").length;
    await new Promise((r) => setTimeout(r, 80));
    expect(world.calls.filter((c) => c.kind === "ps").length).toBe(after);
  });

  it("Restart services from Services & data rotates the token and returns to the app", async () => {
    const b = await readyApp();
    const first = storedToken();
    b.m.openServices();
    await b.m.act({ type: "restartServices" });
    await b.m.idle();
    expect(b.m.state().screen).toBe("app");
    expect(storedToken()).not.toBe(first);
    expect(world.calls.filter((c) => c.kind === "up").at(-1)).toMatchObject({ force: true, token: storedToken() });
  });

  it("port change: 1023, 65536 and a busy port are refused; a free port recreates the stack on it", async () => {
    const b = build({ busy: [18423], cfgEnv: { OPEN_AGENT_SHELL_PORT_RANGE: "18421-18422" } });
    await b.m.boot();
    await b.m.idle();
    b.m.openServices();
    world.calls = [];
    for (const port of [1023, 65536, 18423, 17999, 18421]) {
      expect(await b.m.act({ type: "setPort", port }), String(port)).toEqual({ ok: false, error: "invalid_port" });
    }
    expect(mutations()).toEqual([]);
    expect(await b.m.act({ type: "setPort", port: 18429 })).toEqual({ ok: true });
    await b.m.idle();
    expect(b.m.state()).toMatchObject({ screen: "app", port: 18429 });
    expect(JSON.parse(readFileSync(join(dir, "stack.json"), "utf8")).port).toBe(18429);
    expect(world.calls.filter((c) => c.kind === "up").at(-1)).toMatchObject({ force: true });
    expect(b.views.at(-1)).toBe(`open 18429 ${tokenFingerprint(storedToken())}`);
  });

  it("delete from Services & data: confirm screen → down -v then volume rm with the exact names → a fresh start", async () => {
    const b = await readyApp();
    b.m.openServices();
    expect(await b.m.act({ type: "deleteData", confirm: "delete" })).toEqual({ ok: false, error: "not_confirming" });
    expect(await b.m.act({ type: "resetCredentials", confirm: "reset" })).toEqual({ ok: false, error: "not_confirming" });
    await b.m.act({ type: "confirmDelete" });
    expect(b.m.state().screen).toBe("screen-confirm-delete");
    expect(await b.m.act({ type: "resetCredentials", confirm: "reset" })).toEqual({ ok: false, error: "not_confirming" });
    world.calls = [];
    await b.m.act({ type: "deleteData", confirm: "delete" });
    await b.m.idle();
    expect(kinds().slice(0, 2)).toEqual(["down", "volumeRm"]);
    expect(world.calls.find((c) => c.kind === "volumeRm")?.args).toEqual(["volume", "rm", `${PROJECT}-data`, `${PROJECT}-keys`]);
    expect(b.m.state().screen).toBe("app");
  });

  it("confirm delete → Cancel returns to Services & data; Back from it returns to the app", async () => {
    const b = await readyApp();
    b.m.openServices();
    await b.m.act({ type: "confirmDelete" });
    await b.m.act({ type: "back" });
    expect(b.m.state().screen).toBe("screen-services");
    await b.m.act({ type: "showLogs" });
    expect(b.m.state().screen).toBe("screen-logs");
    await b.m.act({ type: "back" });
    expect(b.m.state().screen).toBe("screen-services");
    await b.m.act({ type: "back" });
    expect(b.m.state().screen).toBe("app");
  });

  it("export from Services & data: the zip lands at the save path, the notice has the wording, partials are tracked and cleared", async () => {
    const b = await readyApp();
    b.m.openServices();
    expect(await b.m.act({ type: "exportData" })).toEqual({ ok: true });
    await b.m.idle();
    expect(existsSync(join(dir, "saved.zip"))).toBe(true);
    expect(b.m.state().screen).toBe("screen-services");
    expect(b.m.state().notice?.text).toContain("Saved model keys are not included. Chats, reports and your profile are.");
    expect(b.settings.writes.some((w) => w.partials?.includes(join(dir, "saved.zip.partial")))).toBe(true);
    expect(b.settings.get().partials).toBeUndefined();
    const exp = world.calls.find((c) => c.kind === "run" && c.args.at(-1) === "export");
    expect(exp?.args).toContain(`${PROJECT}-data:/data`);
  });

  it("export is offered from db_newer but not from db_corrupt", async () => {
    world.up = { refuse: "db_newer", exit: 80 };
    const b = build();
    await b.m.boot();
    await b.m.idle();
    expect(b.m.state().screen).toBe("screen-refusal-db_newer");
    expect(await b.m.act({ type: "exportData" })).toEqual({ ok: true });
    await b.m.idle();
    expect(existsSync(join(dir, "saved.zip"))).toBe(true);
    expect(b.m.state().screen).toBe("screen-refusal-db_newer");
    rmSync(join(dir, "saved.zip"));
    world.up = { refuse: "db_corrupt", exit: 79 };
    await b.m.act({ type: "restartServices" });
    await b.m.idle();
    expect(b.m.state().screen).toBe("screen-refusal-db_corrupt");
    expect(await b.m.act({ type: "exportData" })).toEqual({ ok: false, error: "not_available" });
    expect(existsSync(join(dir, "saved.zip"))).toBe(false);
  });

  it("quit during export aborts it and leaves no .partial", async () => {
    world.exportMode = "slow";
    const b = await readyApp();
    b.m.openServices();
    await b.m.act({ type: "exportData" });
    await until(() => existsSync(join(dir, "saved.zip.partial")));
    expect(await b.m.quit()).toEqual({ kind: "done" });
    expect(readdirSync(dir).filter((f) => f.startsWith("saved.zip"))).toEqual([]);
  });

  it("Save logs writes the redacted service logs and shell.log in two sections", async () => {
    mkdirSync(join(dir, "logs"), { recursive: true });
    const b = await readyApp();
    const token = storedToken();
    writeFileSync(join(dir, "logs/shell.log.1"), `old line token=${token}\n`);
    writeFileSync(join(dir, "logs/shell.log"), "new line\n");
    await b.m.act({ type: "showLogs" });
    expect(await b.m.act({ type: "saveLogs" })).toEqual({ ok: true });
    await b.m.idle();
    const saved = readFileSync(join(dir, "saved.zip"), "utf8");
    expect(saved.indexOf("== service logs ==")).toBe(0);
    expect(saved).toContain("agent-1  | hello");
    expect(saved.indexOf("== shell.log ==")).toBeGreaterThan(saved.indexOf("agent-1"));
    expect(saved.indexOf("old line")).toBeLessThan(saved.indexOf("new line"));
    expect(saved).not.toContain(token);
    expect(saved).toContain("[token]");
    expect(b.m.state().notice?.text).toContain(join(dir, "saved.zip"));
  });

  it("setStopOnQuit persists and the next quit honours it", async () => {
    const b = await readyApp();
    b.m.openServices();
    await b.m.act({ type: "setStopOnQuit", value: false });
    expect(b.settings.get().stopOnQuit).toBe(false);
    expect(b.m.state().settings?.stopOnQuit).toBe(false);
    world.calls = [];
    await b.m.quit();
    expect(mutations()).toEqual([]);
  });
});

describe("service update (D12, 4.4)", () => {
  const NEXT: ServicePins = {
    kind: "dev",
    version: "0.0.0-unit2",
    composeSha256: "x",
    images: { agent: `127.0.0.1:18467/oab-a@sha256:${"c".repeat(64)}`, search: `127.0.0.1:18467/oab-s@sha256:${"d".repeat(64)}` },
    pull: true,
  };
  const offer = (pending: ServicePins | undefined) => {
    const accepted: ServicePins[] = [];
    let current = pending;
    return {
      accepted,
      updates: {
        view: () => ({ appVersion: "0.0.0-dev", ...(current ? { services: current.version } : {}) }),
        pending: () => current,
        accepted: (p: ServicePins) => {
          accepted.push(p);
          current = undefined;
        },
      },
    };
  };

  it("pulls the new refs, recreates with a rotated token and the new images, waits for the new version, then saves it", async () => {
    const o = offer(NEXT);
    const b = build({ updates: o.updates });
    await b.m.boot();
    await b.m.idle();
    const first = storedToken();
    world.calls = [];
    world.versions[NEXT.images.agent] = NEXT.version;
    expect(b.m.state().update).toEqual({ appVersion: "0.0.0-dev", services: "0.0.0-unit2" });
    expect(await b.m.act({ type: "updateServices" })).toEqual({ ok: true });
    await b.m.idle();
    expect(b.m.state()).toMatchObject({ phase: "ready", screen: "app", servicesVersion: "0.0.0-unit2" });
    expect(mutations()).toEqual(["pull", "pull", "up"]);
    expect(world.calls.filter((c) => c.kind === "pull").map((c) => c.args[1])).toEqual([NEXT.images.agent, NEXT.images.search]);
    expect(world.calls.find((c) => c.kind === "up")?.force).toBe(true);
    expect(storedToken()).not.toBe(first);
    expect(world.containers.find((c) => c.service === "agent")?.image).toBe(NEXT.images.agent);
    expect(o.accepted).toEqual([NEXT]);
    expect(b.m.state().update).toEqual({ appVersion: "0.0.0-dev" });
    expect(b.states.map((s) => s.phase)).toEqual(expect.arrayContaining(["pulling", "creating", "waitingHealth"]));
  });

  it("an update that never reports the new version is not saved", async () => {
    const o = offer(NEXT);
    const b = build({ updates: o.updates });
    await b.m.boot();
    await b.m.idle();
    await b.m.act({ type: "updateServices" });
    await b.m.idle();
    expect(b.m.state()).toMatchObject({ screen: "screen-failed", failure: { reason: "health_timeout" } });
    expect(o.accepted).toEqual([]);
    expect(b.m.state().servicesVersion).toBe(PINS.version);
  });

  it("without an offer, Update services re-downloads the current pins", async () => {
    const o = offer(undefined);
    const b = build({ updates: o.updates });
    await b.m.boot();
    await b.m.idle();
    world.calls = [];
    await b.m.act({ type: "updateServices" });
    await b.m.idle();
    expect(world.calls.filter((c) => c.kind === "pull").map((c) => c.args[1])).toEqual([PINS.images.agent, PINS.images.search]);
    expect(o.accepted).toEqual([]);
    expect(b.m.state()).toMatchObject({ screen: "app", servicesVersion: PINS.version });
  });

  it("a local build never applies a manifest", async () => {
    const local: ServicePins = {
      kind: "local",
      version: "local-abc1234",
      composeSha256: "x",
      images: { agent: "oab-m4-agent:local", search: "oab-m4-search:local" },
      imageIds: { agent: ID_A, search: ID_S },
      pull: false,
    };
    world.images = { [local.images.agent]: ID_A, [local.images.search]: ID_S };
    const o = offer(NEXT);
    const b = build({ pins: local, updates: o.updates });
    await b.m.boot();
    await b.m.idle();
    expect(await b.m.act({ type: "updateServices" })).toEqual({ ok: false, error: "not_available" });
    expect(o.accepted).toEqual([]);
  });

  it("openServices shows Services & data with a focus target; Back returns to the app", async () => {
    const b = build({ updates: offer(undefined).updates });
    await b.m.boot();
    await b.m.idle();
    b.m.openServices("update-row");
    expect(b.m.state()).toMatchObject({ screen: "screen-services", focus: "update-row", update: { appVersion: "0.0.0-dev" } });
    b.m.openServices();
    expect(b.m.state().focus).toBeUndefined();
    expect(await b.m.act({ type: "closeServices" })).toEqual({ ok: true });
    expect(b.m.state().screen).toBe("app");
  });

  it("refresh re-emits the current screen with the latest update view", async () => {
    let view = { appVersion: "0.0.0-dev" } as { appVersion: string; shell?: string };
    const b = build({ updates: { view: () => view, pending: () => undefined, accepted: () => {} } });
    await b.m.boot();
    await b.m.idle();
    const n = b.states.length;
    view = { appVersion: "0.0.0-dev", shell: "99.0.0" };
    b.m.refresh();
    expect(b.states.length).toBe(n + 1);
    expect(b.m.state()).toMatchObject({ screen: "app", update: { shell: "99.0.0" } });
  });
});

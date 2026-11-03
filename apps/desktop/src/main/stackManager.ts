import { rmSync } from "node:fs";
import { join } from "node:path";
import type { ActResult, PullRow, ServiceRow, ShellAction, ShellState, UpdateView } from "../shared/actions.ts";
import { classify, versionMatches } from "./classify.ts";
import { type Compose, type ComposeVars, type ContainerInspect, composeFile, type ProjectSpec, SERVICES } from "./compose.ts";
import { diskHint, isDiskFull } from "./diskFull.ts";
import type { DockerCli, DockerLocation, DockerProbe, Rejected, RunResult } from "./dockerCli.ts";
import type { EndpointResult } from "./endpoint.ts";
import { type HealthClient, isOpenAgent } from "./health.ts";
import { newLaunchToken, parseStackFile, type StackFile, tokenFingerprint } from "./launchToken.ts";
import type { Log } from "./logger.ts";
import { type PortPicker, PortsExhaustedError, validPort } from "./portPicker.ts";
import { createPullParser, layerSizesFromManifest } from "./pullProgress.ts";
import { readRefusal, type RefusalReading, savedKeyCount } from "./refusals.ts";
import { redact } from "./redact.ts";
import type { ServicePins } from "./services.ts";
import { createServicesData, type DataOutcome, type SavePath } from "./servicesData.ts";
import type { SettingsStore } from "./settings.ts";
import type { ShellConfig } from "./shellConfig.ts";
import { readStateFile, type ShellPaths, writeStateFile } from "./statePaths.ts";
import { createWatchdog, type StopReason } from "./watchdog.ts";

export type AppView = Readonly<{
  open(port: number, token: string): Promise<void>;
  close(): Promise<void>;
  reload(): void;
}>;

export type PinsLoad = { ok: true; pins: ServicePins } | { ok: false; reason: string };

export type ManagerDeps = Readonly<{
  cfg: ShellConfig;
  paths: ShellPaths;
  log: Log;
  settings: SettingsStore;
  stage: () => { sha256: string; restaged: boolean; reason?: string };
  pins: () => PinsLoad;
  locate: () => DockerLocation;
  pluginsProblem: () => Rejected | undefined;
  makeCli: (path: string) => DockerCli;
  envFor: (cliPath: string, vars?: ComposeVars) => Record<string, string>;
  endpoint: (cli: DockerCli, env: Record<string, string>) => Promise<EndpointResult>;
  probe: (cli: DockerCli, env: Record<string, string>) => Promise<DockerProbe>;
  compose: (cli: DockerCli, spec: ProjectSpec, envFor: (vars?: ComposeVars) => Record<string, string>) => Compose;
  http: HealthClient;
  ports: PortPicker;
  view: AppView;
  apps: () => { dockerDesktop: boolean; orbstack: boolean };
  needsMove: () => boolean;
  moveToApplications: () => void;
  openApp: (path: string) => void;
  relaunch: () => void;
  tokens: { current?: string; previous?: string };
  savePath: SavePath;
  freeBytes: (dir: string) => number;
  updates?: Readonly<{ view(): UpdateView; pending(): ServicePins | undefined; accepted(pins: ServicePins): void }>;
  timings?: Partial<Timings>;
}>;

export type Timings = Readonly<{
  healthTimeoutMs: number;
  pollMs: number;
  dockerPollMs: number;
  watchdogMs: number;
  healthGetMs: number;
  deleteWaitMs: number;
  settleMs: number;
  servicesPollMs: number;
}>;

const DEFAULT_TIMINGS: Timings = {
  healthTimeoutMs: 240_000,
  pollMs: 1000,
  dockerPollMs: 3000,
  watchdogMs: 10_000,
  healthGetMs: 2000,
  deleteWaitMs: 120_000,
  settleMs: 20_000,
  servicesPollMs: 5000,
};

export type QuitOutcome = { kind: "done" } | { kind: "delete_unfinished" };

export interface StackManager {
  state(): ShellState;
  on(cb: (s: ShellState) => void): () => void;
  boot(): Promise<void>;
  act(a: ShellAction): Promise<ActResult>;
  quit(): Promise<QuitOutcome>;
  launchMismatch(): void;
  uiCrashed(): void;
  internalError(): void;
  idle(): Promise<void>;
  openServices(focus?: string): void;
  refresh(): void;
}

type Phase = string;
type Ctx = {
  cli: DockerCli;
  env: Record<string, string>;
  probe: Extract<DockerProbe, { kind: "ok" }>;
  pins: ServicePins;
  endpoint: string;
};

const MUTATING_PHASES = new Set(["creating", "waitingHealth", "resetting", "restarting", "changingPort", "updating", "resuming"]);
const ENGINE_NAMES: Readonly<Record<string, string>> = {
  "docker-desktop": "Docker Desktop",
  orbstack: "OrbStack",
  colima: "Colima",
  "rancher-desktop": "Rancher Desktop",
  other: "Docker",
};
const FOUR_GIB = 4 * 1024 ** 3;
const OVERLAYS = new Set(["screen-services", "screen-logs", "screen-confirm-delete", "screen-confirm-reset"]);
const EXPORTABLE = new Set(["config", "db_newer", "db_migration", "kek_missing", "keyfile_invalid", "ui_missing", "identity"]);
const PORT_TAKEN = /port is already allocated|address already in use/i;

class Aborted extends Error {
  constructor() {
    super("aborted");
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Aborted());
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Aborted());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

const lastLines = (text: string, n: number) => text.split(/\r?\n/).filter(Boolean).slice(-n).join("\n");

export function createStackManager(d: ManagerDeps): StackManager {
  const t: Timings = { ...DEFAULT_TIMINGS, ...d.timings };
  const { cfg, log } = d;
  const listeners = new Set<(s: ShellState) => void>();
  const updateView = () => (d.updates ? { update: d.updates.view() } : {});
  let s: ShellState = { phase: "checkingDocker", screen: "screen-progress", test: cfg.test, settings: settingsView(), ...updateView() };
  let backStack: ShellState[] = [];
  let servicesPoll: AbortController | undefined;
  let ctx: Ctx | undefined;
  let op: { name: string; ac: AbortController; done: Promise<void> } | undefined;
  let pullAc: AbortController | undefined;
  let port: number | undefined;
  let sessionOwns = false;
  let movePassed = false;
  let appShown = false;
  let lastInternal = Number.NEGATIVE_INFINITY;
  let dockerPoll: AbortController | undefined;

  const stagedDir = join(d.paths.stateDir, "stack");
  const stagedCompose = composeFile(stagedDir);
  const redactText = (text: string) => redact(text, [d.tokens.current, d.tokens.previous]);

  function settingsView() {
    const st = d.settings.get();
    return { stopOnQuit: st.stopOnQuit, checkForUpdates: st.checkForUpdates };
  }

  const emit = () => {
    for (const cb of listeners) cb(s);
  };
  const set = (patch: Partial<ShellState> & { phase: Phase; screen: string }, keep = false) => {
    const base: ShellState = {
      phase: patch.phase,
      screen: patch.screen,
      test: cfg.test,
      ...(s.localBuild ? { localBuild: s.localBuild } : {}),
      ...(s.servicesVersion ? { servicesVersion: s.servicesVersion } : {}),
      ...(s.engine ? { engine: s.engine } : {}),
      ...(s.apps ? { apps: s.apps } : {}),
      ...(port !== undefined ? { port } : {}),
      settings: settingsView(),
      ...updateView(),
    };
    if (!OVERLAYS.has(patch.screen)) backStack = [];
    s = keep ? { ...s, ...patch, settings: settingsView(), ...updateView() } : { ...base, ...patch };
    emit();
  };
  const enter = (patch: Partial<ShellState> & { screen: string }) => {
    backStack.push(s);
    set({ phase: s.phase, ...patch });
  };
  const progress = (phase: Phase, extra: Partial<ShellState> = {}) => set({ phase, screen: "screen-progress", ...extra }, true);

  const fail = (reason: string, extra: { step?: string; exitCode?: number; detail?: string; tail?: string } = {}) => {
    log.warn(
      `[stack] failed reason=${reason}${extra.step ? ` step=${extra.step}` : ""}${extra.exitCode !== undefined ? ` exit=${extra.exitCode}` : ""}`,
    );
    set({
      phase: "failed",
      screen: "screen-failed",
      failure: {
        reason,
        ...extra,
        ...(extra.detail ? { detail: redactText(extra.detail) } : {}),
        ...(extra.tail ? { tail: redactText(extra.tail) } : {}),
      },
    });
  };

  const diskFull = (where: "docker" | "mac", detail?: string) => {
    const h = diskHint(ctx?.probe.engine ?? "other");
    log.warn(`[stack] disk full where=${where}`);
    set({
      phase: "diskFull",
      screen: "screen-disk-full",
      disk: { where, engine: h.engine, line: h.line, ...(detail ? { detail: redactText(detail) } : {}) },
    });
  };

  const readStack = (): StackFile | undefined => {
    const r = readStateFile(d.paths.stackFile, parseStackFile);
    if (r.problem && r.problem !== "missing") log.warn(`[state] stack.json ${r.problem}; token discarded and rotated`);
    if (r.value && r.value.project !== cfg.project) return undefined;
    return r.value;
  };

  const vars = (o: { reset?: boolean } = {}): ComposeVars => ({
    port: port ?? 0,
    token: d.tokens.current ?? "",
    agentImage: ctx?.pins.images.agent ?? "",
    searchImage: ctx?.pins.images.search ?? "",
    dataVolume: cfg.dataVolume,
    keysVolume: cfg.keysVolume,
    resetCredentials: o.reset === true,
  });
  const compose = (o: { reset?: boolean } = {}): Compose => {
    if (!ctx) throw new Error("docker is not ready");
    const c = ctx;
    return d.compose(c.cli, { project: cfg.project, stackDir: stagedDir, vars: vars(o) }, (v) => d.envFor(c.cli.path, v));
  };

  const runOp = (name: string, fn: (signal: AbortSignal) => Promise<void>): Promise<void> => {
    const ac = new AbortController();
    const prev = op;
    prev?.ac.abort();
    const done = (async () => {
      if (prev) await prev.done.catch(() => {});
      try {
        await fn(ac.signal);
      } catch (e) {
        if (e instanceof Aborted || ac.signal.aborted) return;
        log.error(`[stack] ${name} error ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
        fail("internal_error", { detail: e instanceof Error ? e.message : String(e) });
      }
    })();
    const entry = { name, ac, done };
    op = entry;
    void done.finally(() => {
      if (op === entry) op = undefined;
    });
    return done;
  };

  const check = (signal: AbortSignal) => {
    if (signal.aborted) throw new Aborted();
  };

  const watchdog = createWatchdog({
    health: d.http,
    port: () => port,
    good: isOpenAgent,
    intervalMs: t.watchdogMs,
    timeoutMs: t.healthGetMs,
    onFirstFailure: async () => {
      log.warn("[watchdog] health failed; app origin closed and launch cookie removed");
      await d.view.close();
    },
    onRecovered: async () => {
      if (!ctx || port === undefined || !d.tokens.current) return false;
      const ep = await d.endpoint(ctx.cli, ctx.env);
      const p = await compose().port();
      if (!ep.ok || p !== `127.0.0.1:${port}`) {
        log.warn(`[watchdog] recovered health but checks failed endpoint=${ep.ok} port=${p ?? "none"}`);
        return false;
      }
      log.info("[watchdog] recovered; launch cookie reinstalled");
      await d.view.open(port, d.tokens.current);
      return true;
    },
    probe: () => probeStopped(),
    onStopped: (r) => void runOp("stopped", () => servicesStopped(r)),
  });

  async function probeStopped(): Promise<StopReason> {
    if (!ctx) return { kind: "docker_stopped" };
    const v = await d.probe(ctx.cli, ctx.env);
    if (v.kind === "stopped") return { kind: "docker_stopped" };
    const c = compose();
    const ps = await c.ps();
    const agentRow = ps?.find((r) => r.service === "agent");
    if (!agentRow) return { kind: "missing" };
    const [agent] = await c.inspect([agentRow.id]);
    if (!agent) return { kind: "missing" };
    if (agent.status === "running") return agent.health === "unhealthy" ? { kind: "unhealthy" } : { kind: "healthy" };
    const reading = readRefusal(agent.exitCode, await c.logs({ services: ["agent"], tail: 200, timestamps: false }));
    if (reading.kind === "refused") return { kind: "refused", code: reading.code, exitCode: agent.exitCode, line: reading.line };
    if (agent.exitCode !== 0) return { kind: "crashed", exitCode: agent.exitCode };
    return { kind: "missing" };
  }

  async function servicesStopped(r: StopReason): Promise<void> {
    log.warn(`[watchdog] services stopped reason=${r.kind}`);
    await d.view.close();
    appShown = false;
    if (r.kind === "refused") {
      const c = compose();
      const ps = await c.ps();
      const agentRow = ps?.find((x) => x.service === "agent");
      const [agent] = agentRow ? await c.inspect([agentRow.id]) : [];
      await handleReading(readRefusal(agent?.exitCode ?? r.exitCode, await c.logs({ services: ["agent"], tail: 200, timestamps: false })));
      return;
    }
    if (r.kind === "docker_stopped") {
      set({ phase: "servicesStopped", screen: "screen-services-stopped", stopped: { reason: "docker_stopped" } });
      pollDocker(() => boot({ forceUp: true }));
      return;
    }
    const tail = await compose()
      .logs({ services: ["agent"], tail: 50, timestamps: false })
      .catch(() => "");
    set({
      phase: "servicesStopped",
      screen: "screen-services-stopped",
      stopped: { reason: r.kind, ...(r.kind === "crashed" ? { exitCode: r.exitCode } : {}), tail: redactText(lastLines(tail, 50)) },
    });
  }

  const pollDocker = (then: () => Promise<void>) => {
    dockerPoll?.abort();
    const ac = new AbortController();
    dockerPoll = ac;
    const loop = async () => {
      while (!ac.signal.aborted) {
        await sleep(t.dockerPollMs, ac.signal).catch(() => {});
        if (ac.signal.aborted) return;
        if (op) continue;
        const loc = d.locate();
        if (loc.kind !== "found") continue;
        const cli = d.makeCli(loc.path);
        const p = await d.probe(cli, d.envFor(cli.path));
        if (ac.signal.aborted) return;
        if (p.kind !== "stopped") {
          log.info("[docker] engine is back");
          ac.abort();
          await then();
          return;
        }
      }
    };
    void loop();
  };

  const rotateToken = () => {
    d.tokens.previous = d.tokens.current;
    d.tokens.current = newLaunchToken();
    if (port === undefined) throw new Error("no port");
    writeStateFile(d.paths.stackFile, {
      schema: 1,
      project: cfg.project,
      port,
      launchToken: d.tokens.current,
      tokenCreatedAt: new Date().toISOString(),
    });
    log.info(`[state] token created fp=${tokenFingerprint(d.tokens.current)}`);
  };

  const imageId = async (ref: string): Promise<string | undefined> => {
    if (!ctx) return undefined;
    const r = await ctx.cli.run(["image", "inspect", "-f", "{{.Id}}", ref], { env: ctx.env, timeoutMs: 15_000, quiet: true });
    return r.code === 0 ? r.stdout.trim() : undefined;
  };

  const expectedImageIds = async (pins: ServicePins) =>
    pins.kind === "local" && pins.imageIds
      ? { agent: pins.imageIds.agent, search: pins.imageIds.search }
      : { agent: await imageId(pins.images.agent), search: await imageId(pins.images.search) };

  const localImagesOk = async (pins: ServicePins) => {
    if (pins.kind !== "local" || !pins.imageIds) return true;
    const [a, b] = [await imageId(pins.images.agent), await imageId(pins.images.search)];
    if (a === pins.imageIds.agent && b === pins.imageIds.search) return true;
    fail("local_images_changed", {
      detail: "The images this build was made with are gone or were rebuilt. Rebuild with npm run dist:local.",
    });
    return false;
  };

  const inspectAll = async (c: Compose): Promise<{ rows: ServiceRow[]; containers: ContainerInspect[] } | undefined> => {
    const ps = await c.ps();
    if (!ps) return undefined;
    const containers = await c.inspect(ps.map((r) => r.id).filter(Boolean));
    return { rows: ps.map((r) => ({ service: r.service, state: r.state, health: r.health })), containers };
  };

  const data = createServicesData({
    paths: d.paths,
    dataVolume: cfg.dataVolume,
    log,
    settings: d.settings,
    savePath: d.savePath,
    freeBytes: d.freeBytes,
    docker: () => (ctx ? { cli: ctx.cli, env: ctx.env, agentRef: ctx.pins.images.agent } : undefined),
    compose: () => compose(),
    redact: redactText,
  });

  const onServices = () => s.screen === "screen-services";
  const updateInfo = (patch: Partial<NonNullable<ShellState["servicesInfo"]>>) => {
    if (!onServices()) return;
    set({ phase: s.phase, screen: s.screen, servicesInfo: { rows: [], ...s.servicesInfo, ...patch } }, true);
  };

  const pollServices = () => {
    servicesPoll?.abort();
    const ac = new AbortController();
    servicesPoll = ac;
    void data.stats().then((st) => {
      if (!ac.signal.aborted) updateInfo(st);
    });
    void (async () => {
      while (!ac.signal.aborted && onServices()) {
        const rows = await data.rows().catch(() => undefined);
        if (ac.signal.aborted) return;
        if (rows) updateInfo({ rows });
        await sleep(t.servicesPollMs, ac.signal).catch(() => {});
      }
    })();
  };

  const restore = (prev: ShellState) => {
    if (!OVERLAYS.has(prev.screen)) {
      servicesPoll?.abort();
      backStack = [];
    }
    if (prev.screen === "app") {
      if (!appShown) return false;
      set({ phase: "ready", screen: "app" });
      return true;
    }
    s = { ...prev, settings: settingsView() };
    emit();
    if (onServices()) pollServices();
    return true;
  };

  function openServices(focus?: string): void {
    if (!ctx) {
      log.info("[services] not available before Docker is ready");
      return;
    }
    if (op && s.phase !== "exporting") {
      log.info(`[services] not opened while ${op.name} runs`);
      return;
    }
    if (onServices()) {
      set({ phase: s.phase, screen: s.screen, focus }, true);
      return;
    }
    log.info("[services] open");
    enter({ screen: "screen-services", servicesInfo: { rows: [] }, ...(focus ? { focus } : {}) });
    pollServices();
  }

  const applyOutcome = (r: DataOutcome, phase: string) => {
    if (r.kind === "notice") set({ phase, screen: s.screen, notice: r.notice }, true);
    else if (r.kind === "failed") fail(r.reason, r.detail ? { detail: r.detail } : {});
    else if (r.kind === "disk") diskFull(r.where, r.detail);
    else if (s.phase === "exporting") set({ phase, screen: s.screen }, true);
  };

  const exportAllowed = () => {
    if ([...backStack, s].some((x) => x.refusal?.code === "db_corrupt")) return false;
    if (s.screen === "screen-services" || s.screen === "screen-confirm-delete") return true;
    return s.screen.startsWith("screen-refusal-") && EXPORTABLE.has(s.refusal?.code ?? "");
  };

  function boot(o: { forceUp?: boolean } = {}): Promise<void> {
    return runOp("boot", (signal) => bootFlow(signal, o));
  }

  async function bootFlow(signal: AbortSignal, o: { forceUp?: boolean } = {}): Promise<void> {
    {
      dockerPoll?.abort();
      watchdog.stop();
      set({ phase: "checkingDocker", screen: "screen-progress" });
      if (!pendingDeleteMatches()) return;

      if (!movePassed && d.needsMove()) {
        set({ phase: "moveToApplications", screen: "screen-move-to-applications" });
        return;
      }
      movePassed = true;

      for (const p of d.settings.get().partials ?? []) rmSync(p, { force: true });
      if (d.settings.get().partials) d.settings.update({}, ["partials"]);

      const staged = d.stage();
      if (staged.restaged) log.info(`[stack] staged ${staged.sha256.slice(0, 12)}${staged.reason ? ` (${staged.reason})` : ""}`);

      const pins = d.pins();
      if (!pins.ok) {
        if (pins.reason === "no_pins") set({ phase: "noPins", screen: "screen-no-pins" });
        else fail("pins_invalid", { detail: pins.reason });
        return;
      }
      s = {
        ...s,
        servicesVersion: pins.pins.version,
        ...(pins.pins.kind === "local" ? { localBuild: `Local build (${pins.pins.version})` } : {}),
      };

      const loc = d.locate();
      const plugins = d.pluginsProblem();
      const apps = d.apps();
      s = { ...s, apps: { ...apps, colima: false } };
      if (loc.kind === "missing" || plugins) {
        const rejected = [...loc.rejected, ...(plugins ? [plugins] : [])];
        log.warn(`[docker] missing searched=${loc.searched.length} rejected=${rejected.map((r) => r.reason).join("; ") || "none"}`);
        set({ phase: "dockerMissing", screen: "screen-docker-missing", docker: { searched: loc.searched, rejected } });
        return;
      }
      const cli = d.makeCli(loc.path);
      const env = d.envFor(cli.path);

      const ep = await d.endpoint(cli, env);
      check(signal);
      if (!ep.ok) {
        log.warn(`[docker] refused endpoint ${ep.endpoint} reason=${ep.reason}`);
        set({
          phase: "dockerRemote",
          screen: "screen-docker-remote",
          remote: { endpoint: ep.endpoint, reason: ep.reason, ...(ep.owner !== undefined ? { owner: ep.owner } : {}) },
        });
        return;
      }

      const probe = await d.probe(cli, env);
      check(signal);
      if (probe.kind === "stopped") {
        set({ phase: "dockerStopped", screen: "screen-docker-stopped" });
        pollDocker(() => boot(o));
        return;
      }
      if (probe.kind === "compose_old") {
        set({ phase: "composeOld", screen: "screen-compose-old", compose: { ...(probe.compose ? { version: probe.compose } : {}) } });
        return;
      }
      if (probe.kind === "not_linux") {
        fail("not_linux", { detail: `the Docker engine runs ${probe.os} containers` });
        return;
      }
      ctx = { cli, env, probe, pins: pins.pins, endpoint: ep.endpoint };
      const memWarning = probe.memBytes !== undefined && probe.memBytes < FOUR_GIB;
      s = {
        ...s,
        apps: { ...apps, colima: probe.context.startsWith("colima") },
        engine: {
          cli: cli.path,
          context: probe.context,
          engine: probe.engine,
          engineName: ENGINE_NAMES[probe.engine] ?? "Docker",
          compose: probe.compose,
          server: probe.server,
          socket: ep.socket,
          ...(probe.memBytes !== undefined ? { memBytes: probe.memBytes } : {}),
          memWarning,
        },
      };
      log.info(`[docker] ok cli=${cli.path} context=${probe.context} engine=${probe.engine} compose=${probe.compose} socket=${ep.socket}`);
      progress("inspecting");

      if (d.settings.get().pendingDelete) {
        set({ phase: "deleting", screen: "screen-stopping", stopping: { what: "Finishing delete…" } });
        if (!(await finishDelete())) return;
        progress("inspecting");
      }

      if (!(await localImagesOk(pins.pins))) return;
      check(signal);

      const c = compose();
      const seen = await inspectAll(c);
      check(signal);
      if (!seen) {
        fail("inspect_failed", { step: "inspect" });
        return;
      }
      const stored = readStack();
      if (stored && stored.launchToken !== d.tokens.current) {
        d.tokens.previous = d.tokens.current;
        d.tokens.current = stored.launchToken;
      }
      const agent = seen.containers.find((x) => x.service === "agent");
      const healthPort = stored?.port ?? agent?.port;
      const health = agent?.status === "running" && healthPort ? await d.http.get(healthPort, 1000) : undefined;
      const verdict = classify({
        containers: seen.containers,
        stored,
        stagedComposePath: stagedCompose,
        pins: pins.pins,
        expectedImageIds: await expectedImageIds(pins.pins),
        health,
      });
      check(signal);
      log.info(`[stack] classify ${verdict.kind}${verdict.reasons.length ? ` (${verdict.reasons.join(", ")})` : ""}`);
      if (verdict.kind === "oursStale") log.info(`[stack] stale: ${verdict.reasons.join(", ")}`);

      const ownPort = verdict.kind !== "foreign" && agent?.status === "running" ? agent.port : undefined;
      switch (verdict.kind) {
        case "foreign": {
          const f = agent ?? seen.containers[0];
          set({
            phase: "foreignStack",
            screen: "screen-foreign-stack",
            foreign: {
              workingDir: f?.workingDir ?? "(unknown)",
              ...(f?.version ? { version: f.version } : {}),
              ...(agent?.port ? { port: agent.port } : {}),
              ...(agent?.dataVolume ? { dataVolume: agent.dataVolume } : {}),
              ...(agent?.keysVolume ? { keysVolume: agent.keysVolume } : {}),
              ourDataVolume: cfg.dataVolume,
              ourKeysVolume: cfg.keysVolume,
            },
          });
          return;
        }
        case "oursRunning":
          port = stored?.port;
          if (o.forceUp) return start(signal, { forceRecreate: true, ownPort });
          return attach(signal);
        case "oursStopped":
          port = stored?.port;
          if (o.forceUp) return start(signal, { forceRecreate: true });
          return resume(signal);
        case "oursStale":
          port = stored?.port ?? agent?.port;
          return start(signal, { forceRecreate: true, ownPort });
        default:
          port = stored?.port;
          return start(signal, { forceRecreate: false });
      }
    }
  }

  async function attach(signal: AbortSignal): Promise<void> {
    progress("attaching");
    sessionOwns = true;
    await ready(signal);
  }

  async function resume(signal: AbortSignal): Promise<void> {
    progress("resuming");
    sessionOwns = true;
    if (!ctx || !(await localImagesOk(ctx.pins))) return;
    const c = compose();
    const r = await upLike(signal, "resuming", (o) => c.start(o));
    if (!r) return;
    await waitHealthy(signal, Date.now());
  }

  async function choosePort(ownPort?: number): Promise<number | "conflict" | "exhausted"> {
    const [lo, hi] = cfg.portRange;
    let p = port;
    if (p === undefined || !validPort(p)) {
      try {
        p = await d.ports.pick([lo, hi]);
      } catch (e) {
        if (e instanceof PortsExhaustedError) return "exhausted";
        throw e;
      }
      port = p;
      log.info(`[stack] port picked ${p}`);
      return p;
    }
    if (ownPort === p) return p;
    const answered = await d.http.get(p, 1000);
    const free = await d.ports.isFree(p);
    if (!free || answered) return "conflict";
    return p;
  }

  async function start(
    signal: AbortSignal,
    o: { forceRecreate: boolean; reset?: boolean; ownPort?: number; forcePull?: boolean },
  ): Promise<void> {
    if (!ctx) return;
    progress("portCheck");
    const chosen = await choosePort(o.ownPort);
    check(signal);
    if (chosen === "exhausted") {
      fail("ports_exhausted", { detail: `no free port in ${cfg.portRange[0]}-${cfg.portRange[1]}` });
      return;
    }
    if (chosen === "conflict") {
      log.warn(`[stack] port conflict ${port}`);
      set({ phase: "portConflict", screen: "screen-port-conflict", conflict: { port: port ?? 0 } });
      return;
    }
    if (!(await pull(signal, o.forcePull === true))) return;
    if (!(await localImagesOk(ctx.pins))) return;
    check(signal);
    rotateToken();
    sessionOwns = true;
    const phase = o.reset ? "resetting" : "creating";
    progress(phase, { pull: s.pull });
    if (o.reset) log.info("[stack] up with OPEN_AGENT_RESET_CREDENTIALS=1 (one invocation)");
    const c = compose({ reset: o.reset });
    const startedAt = Date.now();
    const r = await upLike(signal, phase, (x) => c.up({ forceRecreate: o.forceRecreate, ...x }));
    if (!r) return;
    await waitHealthy(signal, startedAt);
  }

  async function pull(signal: AbortSignal, force: boolean): Promise<boolean> {
    if (!ctx) return false;
    const pins = ctx.pins;
    if (!pins.pull && !force) return true;
    const refs = [
      { name: "agent", ref: pins.images.agent },
      { name: "search", ref: pins.images.search },
    ];
    const todo: { name: string; ref: string }[] = [];
    for (const r of refs) if (force || !(await imageId(r.ref))) todo.push(r);
    check(signal);
    if (todo.length === 0 || !pins.pull) return true;
    const rows: PullRow[] = todo.map((r) => ({ name: r.name, ref: r.ref, layersDone: 0, layersTotal: 0, done: false }));
    progress("pulling", { pull: rows });
    for (let i = 0; i < todo.length; i++) {
      const item = todo[i]!;
      const insecure = /^127\.0\.0\.1:/.test(item.ref) ? ["--insecure"] : [];
      const m = await ctx.cli.run(["manifest", "inspect", ...insecure, "-v", item.ref], {
        env: ctx.env,
        timeoutMs: 15_000,
        quiet: true,
        signal,
      });
      check(signal);
      const sizes = m.code === 0 ? layerSizesFromManifest(m.stdout, ctx.probe.arch) : undefined;
      const parser = createPullParser(item.ref, sizes);
      const update = (p: ReturnType<typeof parser.current>) => {
        const row = rows[i]!;
        const next: PullRow = {
          name: item.name,
          ref: item.ref,
          layersDone: Math.max(row.layersDone, p.layersDone),
          layersTotal: Math.max(row.layersTotal, p.layersTotal),
          ...(p.bytesTotal !== undefined ? { bytesDone: Math.max(row.bytesDone ?? 0, p.bytesDone ?? 0), bytesTotal: p.bytesTotal } : {}),
          done: row.done || p.done,
        };
        if (JSON.stringify(next) !== JSON.stringify(row)) {
          rows[i] = next;
          progress("pulling", { pull: [...rows] });
        }
      };
      update(parser.current());
      pullAc = new AbortController();
      const both = AbortSignal.any([signal, pullAc.signal]);
      const r = await ctx.cli.run(["pull", item.ref], { env: ctx.env, signal: both, onStdoutLine: (l) => update(parser.line(l)) });
      const cancelled = pullAc.signal.aborted;
      pullAc = undefined;
      check(signal);
      if (cancelled) {
        set({ phase: "failed", screen: "screen-failed", failure: { reason: "cancelled", step: "pull" } });
        log.info("[stack] download stopped");
        return false;
      }
      if (r.code !== 0) {
        if (isDiskFull(r.stderr) || isDiskFull(r.stdout)) diskFull("docker", lastLines(r.stderr, 5));
        else fail("pull_failed", { step: "pull", exitCode: r.code ?? -1, tail: lastLines(r.stderr, 20) });
        return false;
      }
      update(parser.finish());
    }
    return true;
  }

  async function detect(): Promise<RefusalReading | undefined> {
    const c = compose();
    const ps = await c.ps();
    const row = ps?.find((r) => r.service === "agent");
    if (!row) return undefined;
    const [agent] = await c.inspect([row.id]);
    if (!agent) return undefined;
    const down = agent.status === "exited" || agent.status === "restarting" || agent.status === "dead";
    if (!down || agent.exitCode === 0) return undefined;
    const reading = readRefusal(agent.exitCode, await c.logs({ services: ["agent"], tail: 200, timestamps: false }));
    return reading.kind === "none" ? undefined : reading;
  }

  async function settleReading(signal: AbortSignal): Promise<RefusalReading | undefined> {
    const until = Date.now() + t.settleMs;
    for (;;) {
      const reading = await detect();
      if (reading || Date.now() > until) return reading;
      await sleep(t.pollMs, signal);
    }
  }

  async function handleReading(reading: RefusalReading): Promise<void> {
    const c = compose();
    if (reading.kind !== "none") {
      const stopped = await c.stop("agent");
      log.info(`[stack] agent stopped after ${reading.kind} exit=${stopped.code}`);
    }
    await d.view.close();
    appShown = false;
    watchdog.stop();
    if (reading.kind === "refused") {
      const exitCode = await inspectAgentExit();
      log.warn(`[stack] refused code=${reading.code}`);
      const count = reading.code === "kek_missing" ? savedKeyCount(reading.message) : undefined;
      set({
        phase: "refused",
        screen: `screen-refusal-${reading.code}`,
        refusal: { code: reading.code, line: redactText(reading.line), exitCode: exitCode ?? 0, ...(count !== undefined ? { count } : {}) },
      });
      return;
    }
    if (reading.kind === "mismatch") {
      fail("refusal_mismatch", {
        ...(reading.exitCode !== undefined ? { exitCode: reading.exitCode } : {}),
        detail: `exit code ${reading.exitCode ?? "none"}; line ${reading.line ?? "none"}`,
      });
      return;
    }
    if (reading.kind === "crashed") {
      const tail = await c.logs({ services: ["agent"], tail: 50, timestamps: false }).catch(() => "");
      fail("crashed", { exitCode: reading.exitCode, tail: lastLines(tail, 50) });
    }
  }

  async function inspectAgentExit(): Promise<number | undefined> {
    const c = compose();
    const row = (await c.ps())?.find((r) => r.service === "agent");
    if (!row) return undefined;
    return (await c.inspect([row.id]))[0]?.exitCode;
  }

  async function upLike(
    signal: AbortSignal,
    phase: string,
    run: (o: { signal: AbortSignal }) => Promise<RunResult>,
  ): Promise<RunResult | undefined> {
    const upAc = new AbortController();
    const both = AbortSignal.any([signal, upAc.signal]);
    let refusal: RefusalReading | undefined;
    const poller = (async () => {
      while (!both.aborted) {
        await sleep(t.pollMs, both).catch(() => {});
        if (both.aborted) return;
        const c = compose();
        const ps = await c.ps();
        if (both.aborted) return;
        if (ps) progress(s.phase === "waitingHealth" ? "waitingHealth" : phase, { services: rowsOf(ps) });
        const reading = await detect();
        if (reading && !both.aborted) {
          refusal = reading;
          upAc.abort();
          return;
        }
      }
    })();
    const r = await run({ signal: both });
    upAc.abort();
    await poller;
    check(signal);
    if (refusal) {
      await handleReading(refusal);
      return undefined;
    }
    if (r.code === 0) return r;
    const text = `${r.stderr}\n${r.stdout}`;
    if (PORT_TAKEN.test(text)) {
      log.warn(`[stack] port conflict ${port} (compose)`);
      set({ phase: "portConflict", screen: "screen-port-conflict", conflict: { port: port ?? 0 } });
      return undefined;
    }
    if (isDiskFull(text)) {
      diskFull("docker", lastLines(r.stderr, 5));
      return undefined;
    }
    const reading = await settleReading(signal);
    if (reading) {
      await handleReading(reading);
      return undefined;
    }
    fail("up_failed", { step: phase === "resuming" ? "start" : "up", exitCode: r.code ?? -1, tail: lastLines(r.stderr, 20) });
    return undefined;
  }

  const rowsOf = (ps: readonly { service: string; state: string; health: string }[]): ServiceRow[] =>
    SERVICES.map((svc) => {
      const r = ps.find((x) => x.service === svc);
      return { service: svc, state: r?.state ?? "missing", health: r?.health ?? "" };
    });

  async function waitHealthy(signal: AbortSignal, startedAt: number): Promise<void> {
    if (!ctx || port === undefined) return;
    progress("waitingHealth");
    const deadline = startedAt + t.healthTimeoutMs;
    const pins = ctx.pins;
    for (;;) {
      check(signal);
      const h = await d.http.get(port, t.healthGetMs);
      check(signal);
      if (isOpenAgent(h) && versionMatches(pins, h.version)) break;
      const ps = await compose().ps();
      if (ps) progress("waitingHealth", { services: rowsOf(ps) });
      const reading = await detect();
      check(signal);
      if (reading) {
        await handleReading(reading);
        return;
      }
      if (Date.now() > deadline) {
        const tail = await compose().logs({ services: ["agent"], tail: 50, timestamps: false });
        fail("health_timeout", { step: "health", tail: lastLines(tail, 50) });
        return;
      }
      await sleep(t.pollMs, signal);
    }
    await ready(signal);
  }

  async function ready(signal: AbortSignal): Promise<void> {
    if (!ctx || port === undefined || !d.tokens.current) {
      fail("internal_error", { detail: "no port or token" });
      return;
    }
    const printed = await compose().port();
    check(signal);
    if (printed !== `127.0.0.1:${port}`) {
      log.warn(`[stack] port check failed: compose printed ${printed ?? "nothing"}, expected 127.0.0.1:${port}`);
      fail("port_mismatch", { detail: `compose port printed ${printed ?? "nothing"}; expected 127.0.0.1:${port}` });
      return;
    }
    log.info(`[stack] port check ok 127.0.0.1:${port}`);
    await d.view.open(port, d.tokens.current);
    check(signal);
    appShown = true;
    log.info(`[stack] ready port=${port} fp=${tokenFingerprint(d.tokens.current)}`);
    set({ phase: "ready", screen: "app" });
    watchdog.start();
  }

  async function deleteAll(signal: AbortSignal): Promise<void> {
    if (!ctx) return;
    watchdog.stop();
    await d.view.close();
    appShown = false;
    set({ phase: "deleting", screen: "screen-stopping", stopping: { what: "Deleting your data…" } });
    const record = { project: cfg.project, dataVolume: cfg.dataVolume, keysVolume: cfg.keysVolume, at: new Date().toISOString() };
    d.settings.update({ pendingDelete: record });
    log.info(`[stack] pendingDelete written ${record.dataVolume} ${record.keysVolume}`);
    if (await finishDelete()) await bootFlow(signal);
  }

  async function finishDelete(): Promise<boolean> {
    if (!ctx) return false;
    const down = await compose().down({ volumes: true });
    if (down.code !== 0) {
      fail("delete_failed", { step: "down", exitCode: down.code ?? -1, tail: lastLines(down.stderr, 10) });
      return false;
    }
    const rm = await ctx.cli.run(["volume", "rm", cfg.dataVolume, cfg.keysVolume], { env: ctx.env, timeoutMs: 120_000 });
    if (rm.code !== 0 && !/no such volume/i.test(rm.stderr)) {
      fail("delete_failed", { step: "volume_rm", exitCode: rm.code ?? -1, tail: lastLines(rm.stderr, 10) });
      return false;
    }
    rmSync(d.paths.stackFile, { force: true });
    d.tokens.previous = d.tokens.current;
    d.tokens.current = undefined;
    port = undefined;
    d.settings.update({}, ["pendingDelete"]);
    log.info("[stack] data deleted; pendingDelete cleared");
    return true;
  }

  function pendingDeleteMatches(): boolean {
    const pending = d.settings.get().pendingDelete;
    if (!pending) return true;
    const current = { project: cfg.project, dataVolume: cfg.dataVolume, keysVolume: cfg.keysVolume };
    const stored = { project: pending.project, dataVolume: pending.dataVolume, keysVolume: pending.keysVolume };
    if (stored.project !== current.project || stored.dataVolume !== current.dataVolume || stored.keysVolume !== current.keysVolume) {
      log.warn("[stack] pending delete does not match the current names; nothing deleted");
      set({ phase: "failed", screen: "screen-failed", failure: { reason: "pending_delete_mismatch" }, pendingDelete: { stored, current } });
      return false;
    }
    return true;
  }

  const confirmGate = (screen: string) => s.screen === screen;

  const act = async (a: ShellAction): Promise<ActResult> => {
    log.info(`[action] ${a.type}`);
    switch (a.type) {
      case "retry":
        if (s.failure?.reason === "ui_crashed" && ctx && port !== undefined && d.tokens.current) {
          void runOp("reload", (signal) => ready(signal));
          return { ok: true };
        }
        void boot();
        return { ok: true };
      case "restartServices":
        void boot({ forceUp: true });
        return { ok: true };
      case "updateServices": {
        const c = ctx;
        if (!c || c.pins.kind === "local") return { ok: false, error: "not_available" };
        const next = d.updates?.pending();
        void runOp("updating", async (signal) => {
          watchdog.stop();
          await d.view.close();
          appShown = false;
          if (next) {
            log.info(`[update] applying services ${next.version}`);
            c.pins = next;
          }
          await start(signal, { forceRecreate: true, forcePull: true, ownPort: port });
          if (!next || s.phase !== "ready") return;
          d.updates?.accepted(next);
          s = { ...s, servicesVersion: next.version };
          set({ phase: s.phase, screen: s.screen }, true);
        });
        return { ok: true };
      }
      case "cancelPull":
        if (!pullAc) return { ok: false, error: "not_available" };
        pullAc.abort();
        return { ok: true };
      case "useAppStack":
        if (s.screen !== "screen-foreign-stack") return { ok: false, error: "not_available" };
        void runOp("useAppStack", async (signal) => {
          port = readStack()?.port;
          await start(signal, { forceRecreate: true });
        });
        return { ok: true };
      case "pickAnotherPort":
        if (s.screen !== "screen-port-conflict" && s.refusal?.code !== "listen") return { ok: false, error: "not_available" };
        void runOp("pickAnotherPort", async (signal) => {
          try {
            port = await d.ports.pick(cfg.portRange, { after: port, skip: port === undefined ? [] : [port] });
          } catch (e) {
            if (e instanceof PortsExhaustedError) return fail("ports_exhausted", { detail: e.message });
            throw e;
          }
          log.info(`[stack] port picked ${port}`);
          await start(signal, { forceRecreate: true });
        });
        return { ok: true };
      case "setPort":
        if (!ctx) return { ok: false, error: "not_available" };
        if (op) return { ok: false, error: "busy" };
        if (!validPort(a.port) || (cfg.test && (a.port < 18000 || a.port > 19999)) || a.port === port)
          return { ok: false, error: "invalid_port" };
        if (!(await d.ports.isFree(a.port))) return { ok: false, error: "invalid_port" };
        void runOp("changingPort", async (signal) => {
          watchdog.stop();
          await d.view.close();
          port = a.port;
          await start(signal, { forceRecreate: true });
        });
        return { ok: true };
      case "confirmReset":
        if (s.refusal?.code !== "kek_missing") return { ok: false, error: "not_available" };
        enter({
          screen: "screen-confirm-reset",
          refusal: s.refusal,
          confirm: {
            ...(s.refusal.count !== undefined ? { count: s.refusal.count } : {}),
            dataVolume: cfg.dataVolume,
            keysVolume: cfg.keysVolume,
          },
        });
        return { ok: true };
      case "resetCredentials":
        if (!confirmGate("screen-confirm-reset")) return { ok: false, error: "not_confirming" };
        void runOp("resetting", (signal) => start(signal, { forceRecreate: true, reset: true }));
        return { ok: true };
      case "confirmDelete":
        if (!ctx) return { ok: false, error: "not_available" };
        enter({
          screen: "screen-confirm-delete",
          confirm: { dataVolume: cfg.dataVolume, keysVolume: cfg.keysVolume, ...(exportAllowed() ? {} : { noExport: true }) },
        });
        return { ok: true };
      case "deleteData":
        if (!confirmGate("screen-confirm-delete")) return { ok: false, error: "not_confirming" };
        void runOp("deleting", (signal) => deleteAll(signal));
        return { ok: true };
      case "discardPendingDelete":
        if (s.failure?.reason !== "pending_delete_mismatch") return { ok: false, error: "not_available" };
        d.settings.update({}, ["pendingDelete"]);
        log.info("[stack] pending delete discarded");
        void boot();
        return { ok: true };
      case "back":
      case "closeServices": {
        let prev = backStack.pop();
        if (a.type === "closeServices") while (prev && OVERLAYS.has(prev.screen)) prev = backStack.pop();
        if (prev && restore(prev)) return { ok: true };
        if (appShown && s.screen !== "app") {
          servicesPoll?.abort();
          set({ phase: "ready", screen: "app" });
          return { ok: true };
        }
        return { ok: false, error: "not_available" };
      }
      case "showLogs": {
        if (!ctx) return { ok: false, error: "not_available" };
        const text = await compose().logs({ services: ["agent", "search", "renderer"], tail: 500, timestamps: true });
        const patch = { screen: "screen-logs", logs: { text: redactText(text) } };
        if (s.screen === "screen-logs") set({ phase: s.phase, ...patch }, true);
        else enter(patch);
        return { ok: true };
      }
      case "saveLogs": {
        if (!ctx) return { ok: false, error: "not_available" };
        applyOutcome(await data.saveLogs(), s.phase);
        return { ok: true };
      }
      case "exportData": {
        if (!ctx || !exportAllowed()) return { ok: false, error: "not_available" };
        if (op) return { ok: false, error: "busy" };
        const phase = s.phase;
        set({ phase: "exporting", screen: s.screen, notice: { tone: "info", text: "Exporting your chats and reports…" } }, true);
        void runOp("exporting", async (signal) => applyOutcome(await data.exportZip(signal), phase));
        return { ok: true };
      }
      case "setStopOnQuit":
        d.settings.update({ stopOnQuit: a.value });
        set({ phase: s.phase, screen: s.screen }, true);
        return { ok: true };
      case "moveToApplications":
        d.moveToApplications();
        return { ok: true };
      case "keepHere":
        if (s.screen !== "screen-move-to-applications") return { ok: false, error: "not_available" };
        d.settings.update({ keepOutsideApplications: true });
        movePassed = true;
        void boot();
        return { ok: true };
      case "openDockerApp":
        d.openApp(a.app === "orbstack" ? "/Applications/OrbStack.app" : "/Applications/Docker.app");
        return { ok: true };
      case "relaunch":
        d.relaunch();
        return { ok: true };
      default:
        return { ok: false, error: "not_available" };
    }
  };

  return {
    state: () => s,
    on: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    boot: () => boot(),
    act,
    openServices,
    quit: async () => {
      watchdog.stop();
      servicesPoll?.abort();
      dockerPoll?.abort();
      const current = op;
      const phase = s.phase;
      if (current && phase === "deleting") {
        set({ phase: "stopping", screen: "screen-stopping", stopping: { what: "Deleting your data…" } }, true);
        const finished = await Promise.race([current.done.then(() => true), sleep(t.deleteWaitMs).then(() => false)]);
        return finished ? { kind: "done" } : { kind: "delete_unfinished" };
      }
      if (current) {
        const what =
          phase === "pulling"
            ? "Stopping the download…"
            : phase === "exporting"
              ? "Stopping the export…"
              : "Stopping Open Agent's services…";
        set({ phase: "stopping", screen: "screen-stopping", stopping: { what } }, true);
        current.ac.abort();
        pullAc?.abort();
        await current.done.catch(() => {});
        if (MUTATING_PHASES.has(phase) && ctx) {
          log.info(`[quit] interrupted ${phase}; stopping the stack`);
          await compose().stop();
        } else {
          log.info(`[quit] interrupted ${phase}`);
        }
        return { kind: "done" };
      }
      if (ctx && sessionOwns && d.settings.get().stopOnQuit) {
        set({ phase: "stopping", screen: "screen-stopping", stopping: { what: "Stopping Open Agent's services…" } }, true);
        await d.view.close().catch(() => {});
        const r = await compose().stop();
        log.info(`[quit] stop-on-quit exit=${r.code}`);
      } else {
        log.info(`[quit] leaving services running (stopOnQuit=${d.settings.get().stopOnQuit} owned=${sessionOwns})`);
      }
      return { kind: "done" };
    },
    launchMismatch: () => {
      if (s.screen !== "app") return;
      log.warn("[stack] launch token mismatch confirmed by probe");
      void runOp("mismatch", async () => {
        watchdog.stop();
        await d.view.close();
        appShown = false;
        fail("launch_mismatch", { detail: "The services were started with a different key" });
      });
    },
    uiCrashed: () => {
      appShown = false;
      watchdog.stop();
      fail("ui_crashed");
    },
    internalError: () => {
      const now = Date.now();
      if (now - lastInternal < 10_000) return;
      lastInternal = now;
      fail("internal_error");
    },
    idle: async () => {
      while (op) await op.done.catch(() => {});
    },
    refresh: () => set({ phase: s.phase, screen: s.screen }, true),
  };
}

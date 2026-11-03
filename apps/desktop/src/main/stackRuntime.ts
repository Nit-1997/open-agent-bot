import { join } from "node:path";
import type { ShellState, UpdateView } from "../shared/actions.ts";
import { type Compose, type ComposeVars, composeFile, type ProjectSpec } from "./compose.ts";
import { diskHint } from "./diskFull.ts";
import type { DockerCli, DockerLocation, DockerProbe, Rejected } from "./dockerCli.ts";
import type { EndpointResult } from "./endpoint.ts";
import type { HealthClient } from "./health.ts";
import { parseStackFile, type StackFile } from "./launchToken.ts";
import type { Log } from "./logger.ts";
import type { PortPicker } from "./portPicker.ts";
import { redact } from "./redact.ts";
import { type ServicePins, stackRefs } from "./services.ts";
import type { SavePath } from "./servicesData.ts";
import type { SettingsStore } from "./settings.ts";
import type { ShellConfig } from "./shellConfig.ts";
import { readStateFile, type ShellPaths } from "./statePaths.ts";

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
  pluginPaths: (cli: DockerCli, env: Record<string, string>) => Promise<Rejected | undefined>;
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

export type Ctx = {
  cli: DockerCli;
  env: Record<string, string>;
  probe: Extract<DockerProbe, { kind: "ok" }>;
  pins: ServicePins;
  endpoint: string;
};

export type Op = { name: string; ac: AbortController; done: Promise<void> };
export type Patch = Partial<ShellState> & { phase: string; screen: string };
export type FailExtra = { step?: string; exitCode?: number; detail?: string; tail?: string };

export const OVERLAYS = new Set(["screen-services", "screen-logs", "screen-confirm-delete", "screen-confirm-reset"]);

export class Aborted extends Error {
  constructor() {
    super("aborted");
  }
}

export const sleep = (ms: number, signal?: AbortSignal) =>
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

export type Runtime = {
  readonly d: ManagerDeps;
  readonly cfg: ShellConfig;
  readonly log: Log;
  readonly t: Timings;
  readonly stagedDir: string;
  readonly stagedCompose: string;
  readonly listeners: Set<(s: ShellState) => void>;
  s: ShellState;
  backStack: ShellState[];
  ctx: Ctx | undefined;
  op: Op | undefined;
  pullAc: AbortController | undefined;
  port: number | undefined;
  sessionOwns: boolean;
  movePassed: boolean;
  appShown: boolean;
  viewOpen: boolean;
  lastInternal: number;
  dockerPoll: AbortController | undefined;
  servicesPoll: AbortController | undefined;
  watchdog: { start(): void; stop(): void };
  settingsView(): { stopOnQuit: boolean; checkForUpdates: boolean };
  emit(): void;
  set(patch: Patch, keep?: boolean): void;
  enter(patch: Partial<ShellState> & { screen: string }): void;
  progress(phase: string, extra?: Partial<ShellState>): void;
  fail(reason: string, extra?: FailExtra): void;
  diskFull(where: "docker" | "mac", detail?: string): void;
  redactText(text: string): string;
  readStack(): StackFile | undefined;
  compose(o?: { reset?: boolean }): Compose;
  runOp(name: string, fn: (signal: AbortSignal) => Promise<void>): Promise<void>;
  check(signal: AbortSignal): void;
  openView(port: number, token: string): Promise<void>;
  closeView(): Promise<void>;
  hideApp(): Promise<void>;
};

export function createRuntime(d: ManagerDeps): Runtime {
  const { cfg, log } = d;
  const stagedDir = join(d.paths.stateDir, "stack");
  const updateView = () => (d.updates ? { update: d.updates.view() } : {});
  const settingsView = () => {
    const st = d.settings.get();
    return { stopOnQuit: st.stopOnQuit, checkForUpdates: st.checkForUpdates };
  };
  const redactText = (text: string) => redact(text, [d.tokens.current, d.tokens.previous]);

  const rt: Runtime = {
    d,
    cfg,
    log,
    t: { ...DEFAULT_TIMINGS, ...d.timings },
    stagedDir,
    stagedCompose: composeFile(stagedDir),
    listeners: new Set(),
    s: { phase: "checkingDocker", screen: "screen-progress", test: cfg.test, settings: settingsView(), ...updateView() },
    backStack: [],
    ctx: undefined,
    op: undefined,
    pullAc: undefined,
    port: undefined,
    sessionOwns: false,
    movePassed: false,
    appShown: false,
    viewOpen: false,
    lastInternal: Number.NEGATIVE_INFINITY,
    dockerPoll: undefined,
    servicesPoll: undefined,
    watchdog: { start: () => {}, stop: () => {} },
    settingsView,
    redactText,

    emit: () => {
      for (const cb of rt.listeners) cb(rt.s);
    },

    set: (patch, keep = false) => {
      const s = rt.s;
      const base: ShellState = {
        phase: patch.phase,
        screen: patch.screen,
        test: cfg.test,
        ...(s.localBuild ? { localBuild: s.localBuild } : {}),
        ...(s.servicesVersion ? { servicesVersion: s.servicesVersion } : {}),
        ...(s.engine ? { engine: s.engine } : {}),
        ...(s.apps ? { apps: s.apps } : {}),
        ...(rt.port !== undefined ? { port: rt.port } : {}),
        settings: settingsView(),
        ...updateView(),
      };
      if (!OVERLAYS.has(patch.screen)) rt.backStack = [];
      rt.s = keep ? { ...s, ...patch, settings: settingsView(), ...updateView() } : { ...base, ...patch };
      rt.emit();
    },

    enter: (patch) => {
      rt.backStack.push(rt.s);
      rt.set({ phase: rt.s.phase, ...patch });
    },

    progress: (phase, extra = {}) => rt.set({ phase, screen: "screen-progress", ...extra }, true),

    fail: (reason, extra = {}) => {
      log.warn(
        `[stack] failed reason=${reason}${extra.step ? ` step=${extra.step}` : ""}${extra.exitCode !== undefined ? ` exit=${extra.exitCode}` : ""}`,
      );
      rt.set({
        phase: "failed",
        screen: "screen-failed",
        failure: {
          reason,
          ...extra,
          ...(extra.detail ? { detail: redactText(extra.detail) } : {}),
          ...(extra.tail ? { tail: redactText(extra.tail) } : {}),
        },
      });
    },

    diskFull: (where, detail) => {
      const h = diskHint(rt.ctx?.probe.engine ?? "other");
      log.warn(`[stack] disk full where=${where}`);
      rt.set({
        phase: "diskFull",
        screen: "screen-disk-full",
        disk: { where, engine: h.engine, line: h.line, ...(detail ? { detail: redactText(detail) } : {}) },
      });
    },

    readStack: () => {
      const r = readStateFile(d.paths.stackFile, parseStackFile);
      if (r.problem && r.problem !== "missing") log.warn(`[state] stack.json ${r.problem}; token discarded and rotated`);
      if (r.value && r.value.project !== cfg.project) return undefined;
      return r.value;
    },

    compose: (o = {}) => {
      const c = rt.ctx;
      if (!c) throw new Error("docker is not ready");
      const vars: ComposeVars = {
        port: rt.port ?? 0,
        token: d.tokens.current ?? "",
        agentImage: stackRefs(c.pins).agent,
        searchImage: stackRefs(c.pins).search,
        dataVolume: cfg.dataVolume,
        keysVolume: cfg.keysVolume,
        resetCredentials: o.reset === true,
      };
      return d.compose(c.cli, { project: cfg.project, stackDir: stagedDir, vars }, (v) => d.envFor(c.cli.path, v));
    },

    runOp: (name, fn) => {
      const ac = new AbortController();
      const prev = rt.op;
      prev?.ac.abort();
      const done = (async () => {
        if (prev) await prev.done.catch(() => {});
        try {
          await fn(ac.signal);
        } catch (e) {
          if (e instanceof Aborted || ac.signal.aborted) return;
          log.error(`[stack] ${name} error ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
          rt.fail("internal_error", { detail: e instanceof Error ? e.message : String(e) });
        }
      })();
      const entry = { name, ac, done };
      rt.op = entry;
      void done.finally(() => {
        if (rt.op === entry) rt.op = undefined;
      });
      return done;
    },

    check: (signal) => {
      if (signal.aborted) throw new Aborted();
    },

    openView: async (port, token) => {
      rt.viewOpen = true;
      await d.view.open(port, token);
    },

    closeView: async () => {
      if (!rt.viewOpen) return;
      rt.viewOpen = false;
      await d.view.close();
    },

    hideApp: async () => {
      rt.watchdog.stop();
      rt.appShown = false;
      await rt.closeView();
    },
  };
  return rt;
}

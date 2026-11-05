import { rmSync } from "node:fs";
import type { PullRow, ServiceRow } from "../shared/actions.ts";
import { lastLines } from "../shared/util.ts";
import { classify, versionMatches } from "./classify.ts";
import { type Compose, type ContainerInspect, SERVICES } from "./compose.ts";
import { isDiskFull } from "./diskFull.ts";
import type { RunResult } from "./dockerCli.ts";
import { isOpenAgent } from "./health.ts";
import { newLaunchToken, tokenFingerprint } from "./launchToken.ts";
import { PortsExhaustedError, validPort } from "./portPicker.ts";
import { createPullParser, layerSizesFromManifest } from "./pullProgress.ts";
import { readRefusal, type RefusalReading, savedKeyCount } from "./refusals.ts";
import type { ServicePins } from "./services.ts";
import { type Runtime, sleep } from "./stackRuntime.ts";
import { writeStateFile } from "./statePaths.ts";
import { createWatchdog, type StopReason } from "./watchdog.ts";

const ENGINE_NAMES: Readonly<Record<string, string>> = {
  "docker-desktop": "Docker Desktop",
  orbstack: "OrbStack",
  colima: "Colima",
  "rancher-desktop": "Rancher Desktop",
  other: "Docker",
};
const FOUR_GIB = 4 * 1024 ** 3;
const PORT_TAKEN = /port is already allocated|address already in use/i;

export type StartOptions = { forceRecreate: boolean; reset?: boolean; ownPort?: number; forcePull?: boolean };

export type Boot = Readonly<{
  boot(o?: { forceUp?: boolean }): Promise<void>;
  start(signal: AbortSignal, o: StartOptions): Promise<void>;
  ready(signal: AbortSignal): Promise<void>;
  deleteAll(signal: AbortSignal): Promise<void>;
}>;

export function createBoot(rt: Runtime): Boot {
  const { d, cfg, log, t, set, progress, fail, diskFull, readStack, compose, runOp, check, redactText, openView, closeView, hideApp } = rt;

  rt.watchdog = createWatchdog({
    health: d.http,
    port: () => rt.port,
    good: isOpenAgent,
    intervalMs: t.watchdogMs,
    timeoutMs: t.healthGetMs,
    log,
    onFirstFailure: async () => {
      log.warn("[watchdog] health failed; app origin closed and launch cookie removed");
      await closeView();
    },
    onRecovered: async () => {
      if (!rt.ctx || rt.port === undefined || !d.tokens.current) return false;
      const ep = await d.endpoint(rt.ctx.cli, rt.ctx.env);
      const p = await compose().port();
      if (!ep.ok || p !== `127.0.0.1:${rt.port}`) {
        log.warn(`[watchdog] recovered health but checks failed endpoint=${ep.ok} port=${p ?? "none"}`);
        return false;
      }
      log.info("[watchdog] recovered; launch cookie reinstalled");
      await openView(rt.port, d.tokens.current);
      return true;
    },
    probe: () => probeStopped(),
    onStopped: (r) => void runOp("stopped", () => servicesStopped(r)),
  });

  async function agentState(): Promise<{ agent?: ContainerInspect; logs(tail: number): Promise<string> }> {
    const c = compose();
    const row = (await c.ps())?.find((r) => r.service === "agent");
    const [agent] = row ? await c.inspect([row.id]) : [];
    const logs = (tail: number) => c.logs({ services: ["agent"], tail, timestamps: false });
    return agent ? { agent, logs } : { logs };
  }

  async function probeStopped(): Promise<StopReason> {
    if (!rt.ctx) return { kind: "docker_stopped" };
    const v = await d.probe(rt.ctx.cli, rt.ctx.env);
    if (v.kind === "stopped") return { kind: "docker_stopped" };
    const { agent, logs } = await agentState();
    if (!agent) return { kind: "missing" };
    if (agent.status === "running") return agent.health === "unhealthy" ? { kind: "unhealthy" } : { kind: "healthy" };
    const reading = readRefusal(agent.exitCode, await logs(200));
    if (reading.kind === "refused") return { kind: "refused", code: reading.code, exitCode: agent.exitCode, line: reading.line };
    if (agent.exitCode !== 0) return { kind: "crashed", exitCode: agent.exitCode };
    return { kind: "missing" };
  }

  async function servicesStopped(r: StopReason): Promise<void> {
    log.warn(`[watchdog] services stopped reason=${r.kind}`);
    await hideApp();
    if (r.kind === "refused") {
      const { agent, logs } = await agentState();
      await handleReading(readRefusal(agent?.exitCode ?? r.exitCode, await logs(200)));
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
    rt.dockerPoll?.abort();
    const ac = new AbortController();
    rt.dockerPoll = ac;
    const loop = async () => {
      while (!ac.signal.aborted) {
        await sleep(t.dockerPollMs, ac.signal).catch(() => {});
        if (ac.signal.aborted) return;
        if (rt.op) continue;
        try {
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
        } catch (e) {
          log.warn(`[docker] poll failed ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    };
    void loop();
  };

  const rotateToken = () => {
    d.tokens.previous = d.tokens.current;
    d.tokens.current = newLaunchToken();
    if (rt.port === undefined) throw new Error("no port");
    writeStateFile(d.paths.stackFile, {
      schema: 1,
      project: cfg.project,
      port: rt.port,
      launchToken: d.tokens.current,
      tokenCreatedAt: new Date().toISOString(),
    });
    log.info(`[state] token created fp=${tokenFingerprint(d.tokens.current)}`);
  };

  const imageId = async (ref: string): Promise<string | undefined> => {
    if (!rt.ctx) return undefined;
    const r = await rt.ctx.cli.run(["image", "inspect", "-f", "{{.Id}}", ref], { env: rt.ctx.env, timeoutMs: 15_000, quiet: true });
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

  function boot(o: { forceUp?: boolean } = {}): Promise<void> {
    return runOp("boot", (signal) => bootFlow(signal, o));
  }

  async function bootFlow(signal: AbortSignal, o: { forceUp?: boolean } = {}): Promise<void> {
    {
      rt.dockerPoll?.abort();
      await hideApp();
      set({ phase: "checkingDocker", screen: "screen-progress" });
      if (!pendingDeleteMatches()) return;

      if (!rt.movePassed && d.needsMove()) {
        set({ phase: "moveToApplications", screen: "screen-move-to-applications" });
        return;
      }
      rt.movePassed = true;

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
      rt.s = {
        ...rt.s,
        servicesVersion: pins.pins.version,
        ...(pins.pins.kind === "local" ? { localBuild: `Local build (${pins.pins.version})` } : {}),
      };

      const loc = d.locate();
      const plugins = d.pluginsProblem();
      const apps = d.apps();
      rt.s = { ...rt.s, apps: { ...apps, colima: false } };
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

      const badPlugin = await d.pluginPaths(cli, env);
      check(signal);
      if (badPlugin) {
        log.warn(`[docker] plugin rejected ${badPlugin.reason}`);
        set({ phase: "dockerMissing", screen: "screen-docker-missing", docker: { searched: loc.searched, rejected: [badPlugin] } });
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
      rt.ctx = { cli, env, probe, pins: pins.pins, endpoint: ep.endpoint };
      const memWarning = probe.memBytes !== undefined && probe.memBytes < FOUR_GIB;
      rt.s = {
        ...rt.s,
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
        stagedComposePath: rt.stagedCompose,
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
          rt.port = stored?.port;
          if (o.forceUp) return start(signal, { forceRecreate: true, ownPort });
          return attach(signal);
        case "oursStopped":
          rt.port = stored?.port;
          if (o.forceUp) return start(signal, { forceRecreate: true });
          return resume(signal);
        case "oursStale":
          rt.port = stored?.port ?? agent?.port;
          return start(signal, { forceRecreate: true, ownPort });
        default:
          rt.port = stored?.port;
          return start(signal, { forceRecreate: false });
      }
    }
  }

  async function attach(signal: AbortSignal): Promise<void> {
    progress("attaching");
    rt.sessionOwns = true;
    await ready(signal);
  }

  async function resume(signal: AbortSignal): Promise<void> {
    progress("resuming");
    rt.sessionOwns = true;
    if (!rt.ctx || !(await localImagesOk(rt.ctx.pins))) return;
    const c = compose();
    const r = await upLike(signal, "resuming", (o) => c.start(o));
    if (!r) return;
    await waitHealthy(signal, Date.now());
  }

  async function choosePort(ownPort?: number): Promise<number | "conflict" | "exhausted"> {
    const [lo, hi] = cfg.portRange;
    let p = rt.port;
    if (p === undefined || !validPort(p)) {
      try {
        p = await d.ports.pick([lo, hi]);
      } catch (e) {
        if (e instanceof PortsExhaustedError) return "exhausted";
        throw e;
      }
      rt.port = p;
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
    if (!rt.ctx) return;
    await hideApp();
    progress("portCheck");
    const chosen = await choosePort(o.ownPort);
    check(signal);
    if (chosen === "exhausted") {
      fail("ports_exhausted", { detail: `no free port in ${cfg.portRange[0]}-${cfg.portRange[1]}` });
      return;
    }
    if (chosen === "conflict") {
      log.warn(`[stack] port conflict ${rt.port}`);
      set({ phase: "portConflict", screen: "screen-port-conflict", conflict: { port: rt.port ?? 0 } });
      return;
    }
    if (!(await pull(signal, o.forcePull === true))) return;
    if (!(await localImagesOk(rt.ctx.pins))) return;
    check(signal);
    rotateToken();
    rt.sessionOwns = true;
    const phase = o.reset ? "resetting" : "creating";
    progress(phase, { pull: rt.s.pull });
    if (o.reset) log.info("[stack] up with OPEN_AGENT_RESET_CREDENTIALS=1 (one invocation)");
    const c = compose({ reset: o.reset });
    const startedAt = Date.now();
    const r = await upLike(signal, phase, (x) => c.up({ forceRecreate: o.forceRecreate, ...x }));
    if (!r) return;
    await waitHealthy(signal, startedAt);
  }

  async function pull(signal: AbortSignal, force: boolean): Promise<boolean> {
    if (!rt.ctx) return false;
    const pins = rt.ctx.pins;
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
      const m = await rt.ctx.cli.run(["manifest", "inspect", ...insecure, "-v", item.ref], {
        env: rt.ctx.env,
        timeoutMs: 15_000,
        quiet: true,
        signal,
      });
      check(signal);
      const sizes = m.code === 0 ? layerSizesFromManifest(m.stdout, rt.ctx.probe.arch) : undefined;
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
      rt.pullAc = new AbortController();
      const both = AbortSignal.any([signal, rt.pullAc.signal]);
      const r = await rt.ctx.cli.run(["pull", item.ref], { env: rt.ctx.env, signal: both, onStdoutLine: (l) => update(parser.line(l)) });
      const cancelled = rt.pullAc.signal.aborted;
      rt.pullAc = undefined;
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
    const { agent, logs } = await agentState();
    if (!agent) return undefined;
    const down = agent.status === "exited" || agent.status === "restarting" || agent.status === "dead";
    if (!down || agent.exitCode === 0) return undefined;
    const reading = readRefusal(agent.exitCode, await logs(200));
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
    await hideApp();
    if (reading.kind === "refused") {
      const exitCode = (await agentState()).agent?.exitCode;
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
        if (ps) progress(rt.s.phase === "waitingHealth" ? "waitingHealth" : phase, { services: rowsOf(ps) });
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
      log.warn(`[stack] port conflict ${rt.port} (compose)`);
      set({ phase: "portConflict", screen: "screen-port-conflict", conflict: { port: rt.port ?? 0 } });
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
    if (!rt.ctx || rt.port === undefined) return;
    progress("waitingHealth");
    const deadline = startedAt + t.healthTimeoutMs;
    const pins = rt.ctx.pins;
    for (;;) {
      check(signal);
      const h = await d.http.get(rt.port, t.healthGetMs);
      check(signal);
      if (isOpenAgent(h)) {
        if (versionMatches(pins, h.version)) break;
        await refuseVersion(pins.version, h.version);
        return;
      }
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

  async function refuseVersion(expected: string, reported: string | undefined): Promise<void> {
    const found = reported?.slice(0, 64);
    log.warn(`[stack] version mismatch expected=${expected} found=${found ?? "none"}`);
    const stopped = await compose().stop("agent");
    log.info(`[stack] agent stopped after version mismatch exit=${stopped.code}`);
    await hideApp();
    set({ phase: "refused", screen: "screen-version-mismatch", versionMismatch: { expected, ...(found ? { found } : {}) } });
  }

  async function ready(signal: AbortSignal): Promise<void> {
    if (!rt.ctx || rt.port === undefined || !d.tokens.current) {
      fail("internal_error", { detail: "no port or token" });
      return;
    }
    const printed = await compose().port();
    check(signal);
    if (printed !== `127.0.0.1:${rt.port}`) {
      log.warn(`[stack] port check failed: compose printed ${printed ?? "nothing"}, expected 127.0.0.1:${rt.port}`);
      fail("port_mismatch", { detail: `compose port printed ${printed ?? "nothing"}; expected 127.0.0.1:${rt.port}` });
      return;
    }
    log.info(`[stack] port check ok 127.0.0.1:${rt.port}`);
    await openView(rt.port, d.tokens.current);
    check(signal);
    rt.appShown = true;
    log.info(`[stack] ready port=${rt.port} fp=${tokenFingerprint(d.tokens.current)}`);
    set({ phase: "ready", screen: "app" });
    rt.watchdog.start();
  }

  async function deleteAll(signal: AbortSignal): Promise<void> {
    if (!rt.ctx) return;
    await hideApp();
    set({ phase: "deleting", screen: "screen-stopping", stopping: { what: "Deleting your data…" } });
    const record = { project: cfg.project, dataVolume: cfg.dataVolume, keysVolume: cfg.keysVolume, at: new Date().toISOString() };
    d.settings.update({ pendingDelete: record });
    log.info(`[stack] pendingDelete written ${record.dataVolume} ${record.keysVolume}`);
    if (await finishDelete()) await bootFlow(signal);
  }

  async function finishDelete(): Promise<boolean> {
    if (!rt.ctx) return false;
    const down = await compose().down({ volumes: true });
    if (down.code !== 0) {
      fail("delete_failed", { step: "down", exitCode: down.code ?? -1, tail: lastLines(down.stderr, 10) });
      return false;
    }
    const rm = await rt.ctx.cli.run(["volume", "rm", cfg.dataVolume, cfg.keysVolume], { env: rt.ctx.env, timeoutMs: 120_000 });
    if (rm.code !== 0 && !/no such volume/i.test(rm.stderr)) {
      fail("delete_failed", { step: "volume_rm", exitCode: rm.code ?? -1, tail: lastLines(rm.stderr, 10) });
      return false;
    }
    rmSync(d.paths.stackFile, { force: true });
    d.tokens.previous = d.tokens.current;
    d.tokens.current = undefined;
    rt.port = undefined;
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

  return { boot, start, ready, deleteAll };
}

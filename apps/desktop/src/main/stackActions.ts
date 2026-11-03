import type { ActResult, ShellAction, ShellState } from "../shared/actions.ts";
import { PortsExhaustedError, validPort } from "./portPicker.ts";
import { stackRefs } from "./services.ts";
import { createServicesData, type DataOutcome } from "./servicesData.ts";
import type { Boot } from "./stackBoot.ts";
import { OVERLAYS, type Runtime, sleep } from "./stackRuntime.ts";

const EXPORTABLE = new Set(["config", "db_newer", "db_migration", "kek_missing", "keyfile_invalid", "ui_missing", "identity"]);

export type Actions = Readonly<{ act(a: ShellAction): Promise<ActResult>; openServices(focus?: string): void }>;

export function createActions(rt: Runtime, b: Boot): Actions {
  const { d, cfg, log, t, set, enter, fail, diskFull, readStack, compose, runOp, redactText, emit, settingsView, hideApp } = rt;
  const { boot, start, ready, deleteAll } = b;

  const data = createServicesData({
    paths: d.paths,
    dataVolume: cfg.dataVolume,
    project: cfg.project,
    log,
    settings: d.settings,
    savePath: d.savePath,
    freeBytes: d.freeBytes,
    docker: () => (rt.ctx ? { cli: rt.ctx.cli, env: rt.ctx.env, agentRef: stackRefs(rt.ctx.pins).agent } : undefined),
    compose: () => compose(),
    redact: redactText,
  });

  const onServices = () => rt.s.screen === "screen-services";
  const updateInfo = (patch: Partial<NonNullable<ShellState["servicesInfo"]>>) => {
    if (!onServices()) return;
    set({ phase: rt.s.phase, screen: rt.s.screen, servicesInfo: { rows: [], ...rt.s.servicesInfo, ...patch } }, true);
  };

  const pollServices = () => {
    rt.servicesPoll?.abort();
    const ac = new AbortController();
    rt.servicesPoll = ac;
    void data
      .stats()
      .catch((e: unknown) => {
        log.warn(`[services] stats failed ${e instanceof Error ? e.message : String(e)}`);
        return { dataProblem: "the data stats couldn't be read (see View logs)" };
      })
      .then((st) => {
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
      rt.servicesPoll?.abort();
      rt.backStack = [];
    }
    if (prev.screen === "app") {
      if (!rt.appShown) return false;
      set({ phase: "ready", screen: "app" });
      return true;
    }
    rt.s = { ...prev, settings: settingsView() };
    emit();
    if (onServices()) pollServices();
    return true;
  };

  function openServices(focus?: string): void {
    if (!rt.ctx) {
      log.info("[services] not available before Docker is ready");
      return;
    }
    if (rt.op && rt.s.phase !== "exporting") {
      log.info(`[services] not opened while ${rt.op.name} runs`);
      return;
    }
    if (onServices()) {
      set({ phase: rt.s.phase, screen: rt.s.screen, focus }, true);
      return;
    }
    log.info("[services] open");
    enter({ screen: "screen-services", servicesInfo: { rows: [] }, ...(focus ? { focus } : {}) });
    pollServices();
  }

  const applyOutcome = (r: DataOutcome, phase: string) => {
    if (r.kind === "notice") set({ phase, screen: rt.s.screen, notice: r.notice }, true);
    else if (r.kind === "failed") fail(r.reason, r.detail ? { detail: r.detail } : {});
    else if (r.kind === "disk") diskFull(r.where, r.detail);
    else if (rt.s.phase === "exporting") set({ phase, screen: rt.s.screen }, true);
  };

  const exportAllowed = () => {
    if ([...rt.backStack, rt.s].some((x) => x.refusal?.code === "db_corrupt")) return false;
    if (rt.s.screen === "screen-services" || rt.s.screen === "screen-confirm-delete") return true;
    return rt.s.screen.startsWith("screen-refusal-") && EXPORTABLE.has(rt.s.refusal?.code ?? "");
  };

  const confirmGate = (screen: string) => rt.s.screen === screen;

  const act = async (a: ShellAction): Promise<ActResult> => {
    log.info(`[action] ${a.type}`);
    switch (a.type) {
      case "retry":
        if (rt.s.failure?.reason === "ui_crashed" && rt.ctx && rt.port !== undefined && d.tokens.current) {
          void runOp("reload", (signal) => ready(signal));
          return { ok: true };
        }
        void boot();
        return { ok: true };
      case "restartServices":
        if (rt.op) return { ok: false, error: "busy" };
        void boot({ forceUp: true });
        return { ok: true };
      case "updateServices": {
        const c = rt.ctx;
        if (!c || c.pins.kind === "local") return { ok: false, error: "not_available" };
        if (rt.op) return { ok: false, error: "busy" };
        const next = d.updates?.pending();
        void runOp("updating", async (signal) => {
          await hideApp();
          if (next) {
            log.info(`[update] applying services ${next.version}`);
            c.pins = next;
          }
          await start(signal, { forceRecreate: true, forcePull: true, ownPort: rt.port });
          if (!next || rt.s.phase !== "ready") return;
          d.updates?.accepted(next);
          rt.s = { ...rt.s, servicesVersion: next.version };
          set({ phase: rt.s.phase, screen: rt.s.screen }, true);
        });
        return { ok: true };
      }
      case "cancelPull":
        if (!rt.pullAc) return { ok: false, error: "not_available" };
        rt.pullAc.abort();
        return { ok: true };
      case "useAppStack":
        if (rt.s.screen !== "screen-foreign-stack") return { ok: false, error: "not_available" };
        void runOp("useAppStack", async (signal) => {
          rt.port = readStack()?.port;
          await start(signal, { forceRecreate: true });
        });
        return { ok: true };
      case "pickAnotherPort":
        if (rt.s.screen !== "screen-port-conflict" && rt.s.refusal?.code !== "listen") return { ok: false, error: "not_available" };
        void runOp("pickAnotherPort", async (signal) => {
          try {
            rt.port = await d.ports.pick(cfg.portRange, { after: rt.port, skip: rt.port === undefined ? [] : [rt.port] });
          } catch (e) {
            if (e instanceof PortsExhaustedError) return fail("ports_exhausted", { detail: e.message });
            throw e;
          }
          log.info(`[stack] port picked ${rt.port}`);
          await start(signal, { forceRecreate: true });
        });
        return { ok: true };
      case "setPort":
        if (!rt.ctx) return { ok: false, error: "not_available" };
        if (rt.op) return { ok: false, error: "busy" };
        if (!validPort(a.port) || (cfg.test && (a.port < 18000 || a.port > 19999)) || a.port === rt.port)
          return { ok: false, error: "invalid_port" };
        if (!(await d.ports.isFree(a.port))) return { ok: false, error: "invalid_port" };
        void runOp("changingPort", async (signal) => {
          await hideApp();
          rt.port = a.port;
          await start(signal, { forceRecreate: true });
        });
        return { ok: true };
      case "confirmReset":
        if (rt.s.refusal?.code !== "kek_missing") return { ok: false, error: "not_available" };
        enter({
          screen: "screen-confirm-reset",
          refusal: rt.s.refusal,
          confirm: {
            ...(rt.s.refusal.count !== undefined ? { count: rt.s.refusal.count } : {}),
            dataVolume: cfg.dataVolume,
            keysVolume: cfg.keysVolume,
          },
        });
        return { ok: true };
      case "resetCredentials":
        if (!confirmGate("screen-confirm-reset")) return { ok: false, error: "not_confirming" };
        if (rt.op) return { ok: false, error: "busy" };
        void runOp("resetting", (signal) => start(signal, { forceRecreate: true, reset: true }));
        return { ok: true };
      case "confirmDelete":
        if (!rt.ctx) return { ok: false, error: "not_available" };
        enter({
          screen: "screen-confirm-delete",
          confirm: { dataVolume: cfg.dataVolume, keysVolume: cfg.keysVolume, ...(exportAllowed() ? {} : { noExport: true }) },
        });
        return { ok: true };
      case "deleteData":
        if (!confirmGate("screen-confirm-delete")) return { ok: false, error: "not_confirming" };
        if (rt.op) return { ok: false, error: "busy" };
        void runOp("deleting", (signal) => deleteAll(signal));
        return { ok: true };
      case "discardPendingDelete":
        if (rt.s.failure?.reason !== "pending_delete_mismatch") return { ok: false, error: "not_available" };
        d.settings.update({}, ["pendingDelete"]);
        log.info("[stack] pending delete discarded");
        void boot();
        return { ok: true };
      case "back":
      case "closeServices": {
        let prev = rt.backStack.pop();
        if (a.type === "closeServices") while (prev && OVERLAYS.has(prev.screen)) prev = rt.backStack.pop();
        if (prev && restore(prev)) return { ok: true };
        if (rt.appShown && rt.s.screen !== "app") {
          rt.servicesPoll?.abort();
          set({ phase: "ready", screen: "app" });
          return { ok: true };
        }
        return { ok: false, error: "not_available" };
      }
      case "showLogs": {
        if (!rt.ctx) return { ok: false, error: "not_available" };
        const text = await compose().logs({ services: ["agent", "search", "renderer"], tail: 500, timestamps: true });
        const patch = { screen: "screen-logs", logs: { text: redactText(text) } };
        if (rt.s.screen === "screen-logs") set({ phase: rt.s.phase, ...patch }, true);
        else enter(patch);
        return { ok: true };
      }
      case "saveLogs": {
        if (!rt.ctx) return { ok: false, error: "not_available" };
        applyOutcome(await data.saveLogs(), rt.s.phase);
        return { ok: true };
      }
      case "exportData": {
        if (!rt.ctx || !exportAllowed()) return { ok: false, error: "not_available" };
        if (rt.op) return { ok: false, error: "busy" };
        const phase = rt.s.phase;
        set({ phase: "exporting", screen: rt.s.screen, notice: { tone: "info", text: "Exporting your chats and reports…" } }, true);
        void runOp("exporting", async (signal) => applyOutcome(await data.exportZip(signal), phase));
        return { ok: true };
      }
      case "setStopOnQuit":
        d.settings.update({ stopOnQuit: a.value });
        set({ phase: rt.s.phase, screen: rt.s.screen }, true);
        return { ok: true };
      case "moveToApplications":
        d.moveToApplications();
        return { ok: true };
      case "keepHere":
        if (rt.s.screen !== "screen-move-to-applications") return { ok: false, error: "not_available" };
        d.settings.update({ keepOutsideApplications: true });
        rt.movePassed = true;
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

  return { act, openServices };
}

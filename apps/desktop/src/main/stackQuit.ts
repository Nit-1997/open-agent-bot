import { type Runtime, sleep } from "./stackRuntime.ts";

const MUTATING_PHASES = new Set(["creating", "waitingHealth", "resetting", "restarting", "changingPort", "updating", "resuming"]);

export type QuitOutcome = { kind: "done" } | { kind: "delete_unfinished" };

export function createQuit(rt: Runtime): () => Promise<QuitOutcome> {
  const { d, log, t, set, compose, closeView } = rt;
  return async () => {
    rt.watchdog.stop();
    rt.servicesPoll?.abort();
    rt.dockerPoll?.abort();
    const current = rt.op;
    const phase = rt.s.phase;
    if (current && phase === "deleting") {
      set({ phase: "stopping", screen: "screen-stopping", stopping: { what: "Deleting your data…" } }, true);
      const timer = new AbortController();
      const finished = await Promise.race([
        current.done.then(() => true),
        sleep(t.deleteWaitMs, timer.signal).then(
          () => false,
          () => true,
        ),
      ]);
      timer.abort();
      return finished ? { kind: "done" } : { kind: "delete_unfinished" };
    }
    if (current) {
      const what =
        phase === "pulling" ? "Stopping the download…" : phase === "exporting" ? "Stopping the export…" : "Stopping Open Agent's services…";
      set({ phase: "stopping", screen: "screen-stopping", stopping: { what } }, true);
      current.ac.abort();
      rt.pullAc?.abort();
      await current.done.catch(() => {});
      if (MUTATING_PHASES.has(phase) && rt.ctx) {
        log.info(`[quit] interrupted ${phase}; stopping the stack`);
        await compose().stop();
      } else {
        log.info(`[quit] interrupted ${phase}`);
      }
      return { kind: "done" };
    }
    if (rt.ctx && rt.sessionOwns && d.settings.get().stopOnQuit) {
      set({ phase: "stopping", screen: "screen-stopping", stopping: { what: "Stopping Open Agent's services…" } }, true);
      await closeView().catch(() => {});
      const r = await compose().stop();
      log.info(`[quit] stop-on-quit exit=${r.code}`);
    } else {
      log.info(`[quit] leaving services running (stopOnQuit=${d.settings.get().stopOnQuit} owned=${rt.sessionOwns})`);
    }
    return { kind: "done" };
  };
}

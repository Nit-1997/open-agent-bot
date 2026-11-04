import type { ActResult, ShellAction, ShellState } from "../shared/actions.ts";
import { createActions } from "./stackActions.ts";
import { createBoot } from "./stackBoot.ts";
import { createQuit, type QuitOutcome } from "./stackQuit.ts";
import { createRuntime, type ManagerDeps } from "./stackRuntime.ts";

export type { QuitOutcome } from "./stackQuit.ts";
export type { AppView, ManagerDeps, PinsLoad, Timings } from "./stackRuntime.ts";

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

export function createStackManager(d: ManagerDeps): StackManager {
  const rt = createRuntime(d);
  const { log, set, fail, runOp, hideApp } = rt;
  const boot = createBoot(rt);
  const actions = createActions(rt, boot);
  const quit = createQuit(rt);

  return {
    state: () => rt.s,
    on: (cb) => {
      rt.listeners.add(cb);
      return () => rt.listeners.delete(cb);
    },
    boot: () => boot.boot(),
    act: actions.act,
    openServices: actions.openServices,
    quit,
    launchMismatch: () => {
      if (rt.s.screen !== "app") return;
      log.warn("[stack] launch token mismatch confirmed by probe");
      void runOp("mismatch", async () => {
        await hideApp();
        fail("launch_mismatch", { detail: "The services were started with a different key" });
      });
    },
    uiCrashed: () => {
      rt.appShown = false;
      rt.watchdog.stop();
      fail("ui_crashed");
    },
    internalError: () => {
      const now = Date.now();
      if (now - rt.lastInternal < 10_000) return;
      rt.lastInternal = now;
      fail("internal_error");
    },
    idle: async () => {
      while (rt.op) await rt.op.done.catch(() => {});
    },
    refresh: () => set({ phase: rt.s.phase, screen: rt.s.screen }, true),
  };
}

export type Closable = Readonly<{ close(): Promise<void> }>;

export type ShutdownDeps = Readonly<{
  signals: Pick<NodeJS.Process, "on">;
  exit: (code: number) => void;
  warn: (line: string) => void;
  deadlineMs?: number;
}>;

export const SHUTDOWN_DEADLINE_MS = 5_000;
const SIGNALS = ["SIGINT", "SIGTERM"] as const;

export function shutdownOnSignals(deps: ShutdownDeps): { ready(running: Closable): void } {
  const deadlineMs = deps.deadlineMs ?? SHUTDOWN_DEADLINE_MS;
  let running: Closable | undefined;
  let signal: string | undefined;
  let closing = false;
  let deadline: NodeJS.Timeout | undefined;
  const finish = (code: number) => {
    clearTimeout(deadline);
    deps.exit(code);
  };

  const close = () => {
    if (closing || !running) return;
    closing = true;
    running.close().then(
      () => finish(0),
      (err: unknown) => {
        deps.warn(`[shutdown] close failed: ${err instanceof Error ? err.message : String(err)}`);
        finish(1);
      },
    );
  };

  for (const s of SIGNALS) {
    deps.signals.on(s, () => {
      if (signal) return;
      signal = s;
      deadline = setTimeout(() => {
        deps.warn(`[shutdown] ${s}: still ${running ? "closing" : "starting"} after ${deadlineMs} ms, exiting`);
        deps.exit(1);
      }, deadlineMs).unref();
      close();
    });
  }

  return {
    ready(r) {
      running = r;
      if (signal) close();
    },
  };
}

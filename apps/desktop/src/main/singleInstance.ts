import type { App } from "electron";
import type { Log } from "./logger.ts";

export function claimSingleInstance(app: App, onSecond: () => void, log: Log): boolean {
  if (!app.requestSingleInstanceLock()) return false;
  app.on("second-instance", () => {
    log.info("[app] second-instance");
    onSecond();
  });
  return true;
}

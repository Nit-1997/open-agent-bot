import type { ActResult, ShellAction, UpdateView } from "../shared/actions.ts";
import type { Log } from "./logger.ts";
import type { ServicePins } from "./services.ts";
import type { SettingsStore } from "./settings.ts";
import { shouldAutoCheck, type UpdateResult } from "./updateCheck.ts";

export type Updates = Readonly<{
  view(): UpdateView;
  auto(): Promise<void>;
  manual(): Promise<void>;
  download(): ActResult;
  dismiss(): ActResult;
  setEnabled(value: boolean): void;
  pending(): ServicePins | undefined;
  accepted(pins: ServicePins): void;
  menuVersion(): string | undefined;
  act(a: ShellAction): Promise<ActResult> | undefined;
}>;

export type UpdatesDeps = Readonly<{
  appVersion: string;
  settings: SettingsStore;
  check?: () => Promise<UpdateResult>;
  now: () => number;
  log: Log;
  onChange: () => void;
  openExternal: (url: string) => void;
}>;

export function createUpdates(d: UpdatesDeps): Updates {
  let shell: { version: string; pageUrl: string } | undefined;
  let services: ServicePins | undefined;
  let incompatible: string | undefined;
  let error: string | undefined;
  let checked = false;
  let running: Promise<void> | undefined;

  const dismissed = () => shell !== undefined && d.settings.get().dismissedVersion === shell.version;

  const run = (manual: boolean): Promise<void> => {
    if (running) return running;
    const check = d.check;
    if (!check) {
      if (manual) {
        error = "not_configured";
        checked = true;
        d.onChange();
      }
      return Promise.resolve();
    }
    d.settings.update({ lastUpdateCheck: new Date(d.now()).toISOString() });
    const how = manual ? "manual" : "automatic";
    d.log.info(`[update] ${how} check`);
    running = (async () => {
      d.onChange();
      let r: UpdateResult;
      try {
        r = await check();
      } catch (e) {
        r = { ok: false, reason: e instanceof Error ? e.name : "failed" };
      }
      if (r.ok) {
        shell = r.shell;
        services = r.services;
        incompatible = r.incompatible;
        error = undefined;
        if (shell) d.log.info(`[update] found app ${shell.version}`);
        if (services) d.log.info(`[update] found services ${services.version}`);
        if (incompatible) d.log.warn(`[update] services manifest incompatible: ${incompatible}`);
        if (!shell && !services && !incompatible) d.log.info("[update] up to date");
      } else {
        d.log.warn(`[update] check failed reason=${r.reason} (${how})${r.detail ? ` ${r.detail}` : ""}`);
        if (manual) error = r.reason;
      }
      if (manual) checked = true;
    })().finally(() => {
      running = undefined;
      d.onChange();
    });
    return running;
  };

  const self: Updates = {
    view: () => ({
      appVersion: d.appVersion,
      ...(shell ? { shell: shell.version } : {}),
      ...(dismissed() ? { dismissed: true } : {}),
      ...(services ? { services: services.version } : {}),
      ...(incompatible ? { incompatible } : {}),
      ...(error ? { error } : {}),
      ...(running ? { checking: true } : {}),
      ...(checked ? { checked: true } : {}),
    }),
    auto: () => {
      const st = d.settings.get();
      if (!d.check) return Promise.resolve();
      if (!shouldAutoCheck(st, d.now())) {
        d.log.info(`[update] automatic check skipped (${st.checkForUpdates ? "checked within 24 h" : "turned off"})`);
        return Promise.resolve();
      }
      return run(false);
    },
    manual: () => run(true),
    download: () => {
      if (!shell) return { ok: false, error: "not_available" };
      d.openExternal(shell.pageUrl);
      return { ok: true };
    },
    dismiss: () => {
      if (!shell) return { ok: false, error: "not_available" };
      d.settings.update({ dismissedVersion: shell.version });
      d.log.info(`[update] dismissed ${shell.version}`);
      d.onChange();
      return { ok: true };
    },
    setEnabled: (value) => {
      d.settings.update({ checkForUpdates: value });
      d.onChange();
    },
    pending: () => services,
    accepted: (pins) => {
      d.log.info(`[update] services ${pins.version} accepted`);
      if (services && services.version === pins.version) services = undefined;
      d.onChange();
    },
    menuVersion: () => (shell && !dismissed() ? shell.version : undefined),
    act: (a) => {
      switch (a.type) {
        case "checkForUpdates":
          return self.manual().then(() => ({ ok: true }));
        case "downloadUpdate":
          return Promise.resolve(self.download());
        case "dismissUpdate":
          return Promise.resolve(self.dismiss());
        case "setCheckForUpdates":
          self.setEnabled(a.value);
          return Promise.resolve({ ok: true });
        default:
          return undefined;
      }
    },
  };
  return self;
}

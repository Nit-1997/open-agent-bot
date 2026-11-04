import { join } from "node:path";
import {
  BaseWindow,
  BrowserWindow,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
  WebContentsView,
} from "electron";
import { type ActResult, type ShellAction, type ShellState, validateAction } from "../shared/actions.ts";
import type { ExternalOpener } from "./externalLinks.ts";
import { describeUrl } from "./firewall.ts";
import type { Log } from "./logger.ts";
import { createOpenBudget, type NavContext, navigationDecision, REPORT_OPEN_BUDGET, SHELL_URL } from "./navigation.ts";
import { APP_PARTITION, nameView } from "./permissions.ts";

export const SHELL_PARTITION = "shell";

const HARDENED = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  webviewTag: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  navigateOnDragDrop: false,
  safeDialogs: true,
} as const;

export type MainWindow = Readonly<{
  window: BaseWindow;
  shellView: WebContentsView;
  appView: WebContentsView;
  showShell(): void;
  showApp(port: number): Promise<void>;
  hideApp(): Promise<void>;
  revealApp(): void;
  reloadApp(): void;
  setTitle(title: string): void;
  sendState(s: ShellState): void;
  focus(): void;
}>;

export type WindowDeps = Readonly<{
  title: string;
  devTools: boolean;
  distDir: string;
  log: Log;
  openExternal: ExternalOpener;
  appOrigin: () => string | undefined;
  getState: () => ShellState;
  act: (a: ShellAction) => Promise<ActResult>;
  onOpenServices: () => void;
  onMismatchHint: () => void;
  onUiCrashed: () => void;
  now?: () => number;
}>;

export const MISMATCH_PROBE_INTERVAL_MS = 10_000;
export const AUTO_RELOAD_WINDOW_MS = 60_000;

export function isLaunchRequired(status: number, body: string): boolean {
  if (status !== 401) return false;
  try {
    const v = JSON.parse(body) as { error?: unknown };
    return v.error === "launch_required";
  } catch {
    return false;
  }
}

export function createMainWindow(d: WindowDeps): MainWindow {
  const window = new BaseWindow({ width: 1200, height: 800, minWidth: 900, minHeight: 600, title: d.title, show: true });
  const shellView = new WebContentsView({
    webPreferences: { ...HARDENED, devTools: d.devTools, partition: SHELL_PARTITION, preload: join(d.distDir, "preload-shell.cjs") },
  });
  const appView = new WebContentsView({
    webPreferences: { ...HARDENED, devTools: d.devTools, partition: APP_PARTITION, preload: join(d.distDir, "preload-app.cjs") },
  });
  nameView(shellView.webContents, "shell");
  nameView(appView.webContents, "app");
  window.contentView.addChildView(appView);
  window.contentView.addChildView(shellView);
  const layout = () => {
    const { width, height } = window.getContentBounds();
    for (const v of [shellView, appView]) v.setBounds({ x: 0, y: 0, width, height });
  };
  layout();
  window.on("resize", layout);
  appView.setVisible(false);

  const reports = new Set<BrowserWindow>();
  const lockdown = (contents: WebContents, view: NavContext["view"]) => {
    const decide = (url: string, mainFrame: boolean, kind: NavContext["kind"]) =>
      navigationDecision(url, { view, appOrigin: d.appOrigin(), mainFrame, kind });
    const onNav = (kind: "navigate" | "redirect") => (event: Electron.Event<{ url: string; isMainFrame: boolean }>) => {
      const r = decide(event.url, event.isMainFrame, kind);
      if (r.action === "allow") return;
      event.preventDefault();
      if (r.action === "external") d.openExternal(r.url);
      else d.log.warn(`[nav] deny ${view} ${kind} ${describeUrl(event.url)}`);
    };
    contents.on("will-navigate", onNav("navigate"));
    contents.on("will-redirect", onNav("redirect"));
    const budget = view === "report" ? createOpenBudget() : undefined;
    contents.setWindowOpenHandler(({ url }) => {
      const r = decide(url, true, "open");
      if (r.action === "external") {
        if (budget?.spent()) d.log.warn(`[nav] deny report open ${describeUrl(url)} (budget of ${REPORT_OPEN_BUDGET} spent)`);
        else if (d.openExternal(r.url) === "opened") budget?.take();
      } else if (r.action === "report") openReport(r.url);
      else d.log.warn(`[nav] deny ${view} open ${describeUrl(url)}`);
      return { action: "deny" };
    });
  };

  const openReport = (url: string) => {
    const report = new BrowserWindow({
      width: 1000,
      height: 800,
      title: "Report",
      webPreferences: { ...HARDENED, devTools: d.devTools, partition: APP_PARTITION },
    });
    nameView(report.webContents, "report");
    watchCrashes(report.webContents, "report");
    reports.add(report);
    report.on("closed", () => reports.delete(report));
    lockdown(report.webContents, "report");
    void report.loadURL(url).catch((e: Error) => d.log.warn(`[report] load failed ${e.message.split(" ")[0]}`));
  };

  const now = d.now ?? Date.now;
  const lastAutoReload = new WeakMap<WebContents, number>();
  function watchCrashes(contents: WebContents, view: "app" | "report") {
    contents.on("render-process-gone", (_e, details) => {
      const last = lastAutoReload.get(contents) ?? Number.NEGATIVE_INFINITY;
      d.log.warn(`[app] ${view} renderer gone reason=${details.reason}`);
      if (now() - last > AUTO_RELOAD_WINDOW_MS) {
        lastAutoReload.set(contents, now());
        d.log.info(`[app] ${view} reloaded after renderer crash`);
        contents.reload();
        return;
      }
      d.onUiCrashed();
    });
  }

  lockdown(shellView.webContents, "shell");
  lockdown(appView.webContents, "app");
  watchCrashes(appView.webContents, "app");
  shellView.webContents.on("render-process-gone", (_e, details) => {
    d.log.warn(`[shell] renderer gone reason=${details.reason}; reloaded`);
    shellView.webContents.reload();
  });

  let lastProbe = Number.NEGATIVE_INFINITY;
  const appSession = appView.webContents.session;
  appSession.webRequest.onCompleted((details) => {
    const origin = d.appOrigin();
    if (details.statusCode !== 401 || !origin || originOf(details.url) !== origin) return;
    if (!new URL(details.url).pathname.startsWith("/api/")) return;
    const t = now();
    if (t - lastProbe < MISMATCH_PROBE_INTERVAL_MS) return;
    lastProbe = t;
    d.log.info("[app] 401 from the app; probing the launch cookie");
    void appSession
      .fetch(`${origin}/api/chats`, { credentials: "include", cache: "no-store" })
      .then(async (r) => {
        const body = await r.text();
        if (isLaunchRequired(r.status, body.slice(0, 4096))) d.onMismatchHint();
        else d.log.info(`[app] probe status=${r.status}; ignored`);
      })
      .catch((e: Error) => d.log.warn(`[app] probe failed ${e.message.split(" ")[0]}`));
  });

  const isShellSender = (e: IpcMainInvokeEvent) =>
    e.sender === shellView.webContents &&
    e.senderFrame === shellView.webContents.mainFrame &&
    (e.senderFrame?.url ?? "").startsWith("oa-shell://screens/");
  const isAppSender = (e: IpcMainEvent) =>
    e.sender === appView.webContents && e.senderFrame === appView.webContents.mainFrame && originOf(e.senderFrame?.url) === d.appOrigin();

  ipcMain.handle("shell:state", (e) => {
    if (!isShellSender(e)) {
      d.log.warn("[ipc] forbidden shell:state");
      return { ok: false, error: "forbidden" };
    }
    return d.getState();
  });
  ipcMain.handle("shell:act", (e, payload: unknown) => {
    if (!isShellSender(e)) {
      d.log.warn("[ipc] forbidden shell:act");
      return { ok: false, error: "forbidden" } satisfies ActResult;
    }
    const action = validateAction(payload);
    if (!action) {
      d.log.warn("[ipc] invalid_action");
      return { ok: false, error: "invalid_action" } satisfies ActResult;
    }
    return d.act(action);
  });
  let lastServices = Number.NEGATIVE_INFINITY;
  ipcMain.on("app:open-services", (e) => {
    if (!isAppSender(e)) {
      d.log.warn("[ipc] forbidden app:open-services");
      return;
    }
    const now = Date.now();
    if (now - lastServices < 1000) return;
    lastServices = now;
    d.onOpenServices();
  });

  window.on("closed", () => {
    for (const r of reports) if (!r.isDestroyed()) r.close();
    ipcMain.removeHandler("shell:state");
    ipcMain.removeHandler("shell:act");
    ipcMain.removeAllListeners("app:open-services");
  });

  void appView.webContents.loadURL("about:blank").catch(() => {});
  void shellView.webContents.loadURL(SHELL_URL).catch((e: Error) => d.log.error(`[shell] load failed ${e.message.split(" ")[0]}`));

  return {
    window,
    shellView,
    appView,
    showShell: () => {
      shellView.setVisible(true);
      appView.setVisible(false);
      shellView.webContents.focus();
    },
    showApp: async (port) => {
      await appView.webContents.loadURL(`http://127.0.0.1:${port}/`);
      appView.setVisible(true);
      shellView.setVisible(false);
      appView.webContents.focus();
    },
    hideApp: async () => {
      appView.setVisible(false);
      shellView.setVisible(true);
      if (appView.webContents.getURL() !== "about:blank") await appView.webContents.loadURL("about:blank").catch(() => {});
    },
    revealApp: () => {
      const origin = d.appOrigin();
      if (!origin || originOf(appView.webContents.getURL()) !== origin || appView.getVisible()) return;
      appView.setVisible(true);
      shellView.setVisible(false);
      appView.webContents.focus();
    },
    setTitle: (title) => {
      if (!window.isDestroyed()) window.setTitle(title);
    },
    reloadApp: () => {
      if (appView.getVisible()) appView.webContents.reload();
    },
    sendState: (s) => {
      if (!shellView.webContents.isDestroyed()) shellView.webContents.send("shell:state", s);
    },
    focus: () => {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    },
  };
}

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

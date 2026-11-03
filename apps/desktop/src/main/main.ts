import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { app, dialog, Menu, protocol, session, shell } from "electron";
import type { ActResult, ShellAction, ShellState } from "../shared/actions.ts";
import { createExternalOpener, LINKS } from "./externalLinks.ts";
import { installFirewall } from "./firewall.ts";
import { installLaunchCookie, loadStackToken } from "./launchToken.ts";
import { createLogger, type Log } from "./logger.ts";
import { buildMenuTemplate } from "./menu.ts";
import { APP_PARTITION, hardenSession, hardenWebContents } from "./permissions.ts";
import { registerShellProtocol } from "./screens.ts";
import { loadShellConfig, type ShellConfig, ShellConfigError, windowTitle } from "./shellConfig.ts";
import { claimSingleInstance } from "./singleInstance.ts";
import { ensurePrivateDir, resolvePaths } from "./statePaths.ts";
import { createMainWindow, type MainWindow, SHELL_PARTITION } from "./windows.ts";

const APP_NAME = "Open Agent";

protocol.registerSchemesAsPrivileged([{ scheme: "oa-shell", privileges: { standard: true, secure: true } }]);
app.enableSandbox();
app.setName(APP_NAME);

function refuse(e: unknown): void {
  const message = e instanceof ShellConfigError ? e.message : `Unexpected error: ${String(e)}`;
  process.stderr.write(`[config] refused ${message}\n`);
  void app.whenReady().then(() => {
    dialog.showErrorBox("Open Agent can't start", message);
    app.exit(78);
  });
}

function configure(): ShellConfig | undefined {
  try {
    return loadShellConfig(process.env);
  } catch (e) {
    refuse(e);
    return undefined;
  }
}

function start(cfg: ShellConfig): void {
  if (cfg.test && cfg.stateDir) {
    app.setPath("userData", join(cfg.stateDir, cfg.singleInstanceId ? `electron-${cfg.singleInstanceId}` : "electron"));
    app.setPath("logs", join(cfg.stateDir, "logs"));
  }
  const paths = resolvePaths(cfg, { userData: app.getPath("userData"), logs: app.getPath("logs") });
  ensurePrivateDir(paths.stateDir);
  ensurePrivateDir(paths.userData);

  const tokens: { current?: string } = {};
  const log = createLogger({ dir: paths.logsDir, tokens: () => [tokens.current] });
  for (const name of cfg.ignored) log.warn(`[config] ignored ${name} (test mode is off)`);

  let main: MainWindow | undefined;
  if (!claimSingleInstance(app, () => main?.focus(), log)) {
    app.exit(0);
    return;
  }
  log.info(`[app] start version=${app.getVersion()} packaged=${app.isPackaged} test=${cfg.test}`);

  process.on("uncaughtException", (e) => log.error(`[app] uncaught ${e.stack ?? String(e)}`));
  process.on("unhandledRejection", (e) => log.error(`[app] unhandled ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`));

  app.on("web-contents-created", (_e, contents) => hardenWebContents(contents, log));
  app.on("window-all-closed", () => app.quit());

  let appPort: number | undefined;
  const appOrigin = () => (appPort === undefined ? undefined : `http://127.0.0.1:${appPort}`);
  let state: ShellState = { phase: "checkingDocker", screen: "screen-progress", test: cfg.test };
  const setState = (next: ShellState) => {
    state = next;
    main?.sendState(state);
  };

  const openExternal = createExternalOpener({
    now: Date.now,
    log,
    open: (url) => (cfg.test && cfg.externalLog ? appendFileSync(cfg.externalLog, `${url}\n`, { mode: 0o600 }) : shell.openExternal(url)),
  });

  const act = async (a: ShellAction): Promise<ActResult> => {
    log.info(`[action] ${a.type}`);
    switch (a.type) {
      case "quit":
        app.quit();
        return { ok: true };
      case "openLink":
        openExternal(LINKS[a.link]);
        return { ok: true };
      case "deleteData":
      case "resetCredentials":
        return { ok: false, error: "not_confirming" };
      default:
        return { ok: false, error: "not_available" };
    }
  };

  app.whenReady().then(async () => {
    const appSession = session.fromPartition(APP_PARTITION);
    const shellSession = session.fromPartition(SHELL_PARTITION);
    hardenSession(session.defaultSession, { name: "default", appOrigin, log });
    hardenSession(shellSession, { name: SHELL_PARTITION, appOrigin, log });
    hardenSession(appSession, { name: APP_PARTITION, appOrigin, savePath: cfg.savePath, log });
    installFirewall(appSession, () => appPort, log);
    registerShellProtocol(shellSession, join(__dirname, "screens"));

    const menuHandlers = {
      packaged: app.isPackaged,
      appName: APP_NAME,
      onServices: () => log.info("[menu] services"),
      onCheckUpdates: () => log.info("[menu] check-updates"),
      onReloadApp: () => main?.reloadApp(),
      onOpenLink: (link: keyof typeof LINKS) => openExternal(LINKS[link]),
    };
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(menuHandlers)));

    main = createMainWindow({
      title: windowTitle(cfg),
      devTools: !app.isPackaged,
      distDir: __dirname,
      log,
      openExternal,
      appOrigin,
      getState: () => state,
      act,
      onOpenServices: () => log.info("[app] open-services"),
    });
    main.window.on("closed", () => {
      main = undefined;
      app.quit();
    });
    log.info("[app] ready");

    if (cfg.test && cfg.attachPort) await attach(cfg, cfg.attachPort, log);
  });

  const attach = async (c: ShellConfig, port: number, l: Log) => {
    const { token } = loadStackToken(paths.stackFile, { project: c.project, port }, l);
    tokens.current = token;
    appPort = port;
    await installLaunchCookie(session.fromPartition(APP_PARTITION), port, token);
    l.info(`[app] attach port=${port}`);
    await main?.showApp(port);
    setState({ phase: "ready", screen: "app", test: c.test, port });
    l.info("[app] app view loaded");
  };
}

const cfg = configure();
if (cfg) start(cfg);

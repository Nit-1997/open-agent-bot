import { appendFileSync, existsSync, readFileSync, statfsSync } from "node:fs";
import { join } from "node:path";
import { app, dialog, Menu, protocol, session, shell } from "electron";
import { createCompose } from "./compose.ts";
import { cliPluginsProblem, createDockerCli, dockerEnv, dockerPath, locateDocker, probeDocker } from "./dockerCli.ts";
import { resolveEndpoint } from "./endpoint.ts";
import { createExternalOpener, LINKS } from "./externalLinks.ts";
import { installFirewall } from "./firewall.ts";
import { currentUid } from "./fsProbe.ts";
import { httpHealth } from "./health.ts";
import { installLaunchCookie, removeLaunchCookie } from "./launchToken.ts";
import { createLogger } from "./logger.ts";
import { buildMenuTemplate } from "./menu.ts";
import { needsMovePrompt } from "./moveToApplications.ts";
import { APP_PARTITION, hardenSession, hardenWebContents } from "./permissions.ts";
import { createPortPicker } from "./portPicker.ts";
import { registerShellProtocol } from "./screens.ts";
import type { SavePath } from "./servicesData.ts";
import { effectivePins, validatePins } from "./services.ts";
import { createSettingsStore } from "./settings.ts";
import { loadShellConfig, type ShellConfig, ShellConfigError, windowTitle } from "./shellConfig.ts";
import { claimSingleInstance } from "./singleInstance.ts";
import { bundledComposeSha, stageStack } from "./stackFiles.ts";
import { createStackManager, type PinsLoad, type StackManager } from "./stackManager.ts";
import { ensurePrivateDir, resolvePaths } from "./statePaths.ts";
import { createStatusWriter } from "./status.ts";
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

  const tokens: { current?: string; previous?: string } = {};
  const log = createLogger({ dir: paths.logsDir, tokens: () => [tokens.current, tokens.previous] });
  for (const name of cfg.ignored) log.warn(`[config] ignored ${name} (test mode is off)`);

  let main: MainWindow | undefined;
  if (!claimSingleInstance(app, () => main?.focus(), log)) {
    app.exit(0);
    return;
  }
  log.info(`[app] start version=${app.getVersion()} packaged=${app.isPackaged} test=${cfg.test}`);

  let manager: StackManager | undefined;
  const onInternal = (kind: string, e: unknown) => {
    log.error(`[app] ${kind} ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    manager?.internalError();
  };
  process.on("uncaughtException", (e) => onInternal("uncaught", e));
  process.on("unhandledRejection", (e) => onInternal("unhandled", e));

  app.on("web-contents-created", (_e, contents) => hardenWebContents(contents, log));

  let appPort: number | undefined;
  const appOrigin = () => (appPort === undefined ? undefined : `http://127.0.0.1:${appPort}`);

  const openExternal = createExternalOpener({
    now: Date.now,
    log,
    open: (url) => (cfg.test && cfg.externalLog ? appendFileSync(cfg.externalLog, `${url}\n`, { mode: 0o600 }) : shell.openExternal(url)),
  });

  const bundledDir = app.isPackaged ? join(process.resourcesPath, "stack") : join(app.getAppPath(), "build/stack");
  const settings = createSettingsStore(paths.settingsFile, log);
  const writeStatus = createStatusWriter(paths.statusFile);
  const uid = currentUid();

  const loadPins = (): PinsLoad => {
    if (!existsSync(join(bundledDir, "docker-compose.yml"))) return { ok: false, reason: "stack_missing" };
    const ctx = { test: cfg.test, composeSha256: bundledComposeSha(bundledDir), shellVersion: app.getVersion() };
    const source = cfg.test && cfg.servicesOverride ? cfg.servicesOverride : join(bundledDir, "services.lock.json");
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(source, "utf8"));
    } catch {
      return { ok: false, reason: "unreadable" };
    }
    const bundled = validatePins(raw, ctx);
    if (!bundled.ok) return bundled;
    const pins = effectivePins(bundled.pins, undefined);
    return pins ? { ok: true, pins } : { ok: false, reason: "no_pins" };
  };

  const envFor = (cliPath: string, vars?: Parameters<typeof dockerEnv>[2]) =>
    dockerEnv(dockerPath(cliPath, { onDropped: (r) => log.warn(`[docker] PATH entry dropped ${r.reason}`) }), process.env, vars);

  const appSessionRef = () => session.fromPartition(APP_PARTITION);

  const savePath: SavePath = async ({ defaultName, message }) => {
    if (cfg.test) return cfg.savePath;
    const options = {
      defaultPath: join(app.getPath("downloads"), defaultName),
      message,
      properties: ["createDirectory", "showOverwriteConfirmation"] as ("createDirectory" | "showOverwriteConfirmation")[],
    };
    const r = main ? await dialog.showSaveDialog(main.window, options) : await dialog.showSaveDialog(options);
    return r.canceled || !r.filePath ? undefined : r.filePath;
  };
  const freeBytes = (dir: string) => {
    const st = statfsSync(dir);
    return st.bavail * st.bsize;
  };

  manager = createStackManager({
    cfg,
    paths,
    log,
    settings,
    tokens,
    stage: () => stageStack({ bundledDir, stagedDir: join(paths.stateDir, "stack") }),
    pins: loadPins,
    locate: () => locateDocker(cfg),
    pluginsProblem: () => cliPluginsProblem(),
    makeCli: (path) => createDockerCli(path, { log, tokens: () => [tokens.current, tokens.previous] }),
    envFor,
    endpoint: (cli, env) => resolveEndpoint(cli, env, uid, { allowSystemSocket: cfg.test && cfg.allowSystemSocket }),
    probe: probeDocker,
    compose: createCompose,
    http: httpHealth,
    ports: createPortPicker(),
    view: {
      open: async (port, token) => {
        appPort = port;
        await installLaunchCookie(appSessionRef(), port, token);
        log.info(`[app] cookie installed port=${port}`);
        await main?.showApp(port);
        log.info("[app] app view loaded");
      },
      close: async () => {
        const port = appPort;
        appPort = undefined;
        main?.hideApp();
        if (port !== undefined) await removeLaunchCookie(appSessionRef(), port).catch(() => {});
      },
      reload: () => main?.reloadApp(),
    },
    apps: () => ({ dockerDesktop: existsSync("/Applications/Docker.app"), orbstack: existsSync("/Applications/OrbStack.app") }),
    needsMove: () =>
      needsMovePrompt({
        packaged: app.isPackaged,
        test: cfg.test,
        fakeOutside: cfg.fakeOutside,
        inApplications: app.isPackaged ? app.isInApplicationsFolder() : true,
        keepOutside: settings.get().keepOutsideApplications === true,
      }),
    moveToApplications: () => {
      if (cfg.test) {
        log.info("[app] moveToApplicationsFolder (test mode: not moved)");
        return;
      }
      try {
        app.moveToApplicationsFolder({ conflictHandler: () => true });
      } catch (e) {
        log.warn(`[app] move to Applications failed ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    openApp: (path) => {
      if (cfg.test) log.info(`[action] openDockerApp ${path} (test mode: not opened)`);
      else void shell.openPath(path);
    },
    relaunch: () => {
      app.relaunch();
      app.exit(0);
    },
    savePath,
    freeBytes,
  });
  const mgr = manager;

  mgr.on((s) => {
    main?.sendState(s);
    if (s.screen !== "app") main?.showShell();
    else if (appPort !== undefined) main?.revealApp();
    try {
      writeStatus(s, s.servicesVersion);
    } catch (e) {
      log.warn(`[state] status.json not written ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  let quitting = false;
  app.on("before-quit", (e) => {
    if (quitting) return;
    e.preventDefault();
    quitting = true;
    void mgr
      .quit()
      .then((outcome) => {
        if (outcome.kind !== "delete_unfinished") return;
        log.warn("[quit] delete unfinished; it finishes at the next launch");
        if (!cfg.test)
          dialog.showMessageBoxSync({
            type: "warning",
            message: "Deleting your data didn't finish. Open Agent will finish it the next time it starts.",
          });
      })
      .catch((err: unknown) => log.error(`[quit] ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => {
        log.info("[app] exit");
        app.exit(0);
      });
  });

  app.whenReady().then(async () => {
    const appSession = appSessionRef();
    const shellSession = session.fromPartition(SHELL_PARTITION);
    hardenSession(session.defaultSession, { name: "default", appOrigin, log });
    hardenSession(shellSession, { name: SHELL_PARTITION, appOrigin, log });
    hardenSession(appSession, { name: APP_PARTITION, appOrigin, savePath: cfg.savePath, log });
    installFirewall(appSession, () => appPort, log);
    registerShellProtocol(shellSession, join(__dirname, "screens"));

    const menuHandlers = {
      packaged: app.isPackaged,
      appName: APP_NAME,
      onServices: () => {
        log.info("[menu] services");
        mgr.openServices();
      },
      onCheckUpdates: () => log.info("[menu] check-updates"),
      onReloadApp: () => main?.reloadApp(),
      onOpenLink: (link: keyof typeof LINKS) => openExternal(LINKS[link]),
    };
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(menuHandlers)));

    main = createMainWindow({
      title: windowTitle(cfg, mgr.state().localBuild),
      devTools: !app.isPackaged,
      distDir: __dirname,
      log,
      openExternal,
      appOrigin,
      getState: () => mgr.state(),
      act: (a) => {
        if (a.type === "quit") {
          app.quit();
          return Promise.resolve({ ok: true });
        }
        if (a.type === "openLink") {
          openExternal(LINKS[a.link]);
          return Promise.resolve({ ok: true });
        }
        return mgr.act(a);
      },
      onOpenServices: () => {
        log.info("[app] open-services");
        mgr.openServices();
      },
      onMismatchHint: () => mgr.launchMismatch(),
      onUiCrashed: () => mgr.uiCrashed(),
    });
    main.window.on("close", (e) => {
      if (quitting) return;
      e.preventDefault();
      app.quit();
    });
    mgr.on((s) => main?.setTitle(windowTitle(cfg, s.localBuild)));
    log.info("[app] ready");
    void mgr.boot();
  });
}

const cfg = configure();
if (cfg) start(cfg);

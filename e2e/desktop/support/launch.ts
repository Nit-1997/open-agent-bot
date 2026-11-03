import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron, type ElectronApplication, expect, type Page, type TestInfo } from "@playwright/test";
import { DESKTOP } from "./fakeDocker";

const require = createRequire(join(DESKTOP, "package.json"));
export const ELECTRON: string = require("electron");

export type ShellEnv = Readonly<{
  stateDir: string;
  project: string;
  portRange: string;
  attachPort?: number;
  externalLog: string;
  savePath: string;
  extra?: Record<string, string>;
}>;

export function newStateDir(label: string): string {
  const root = join(tmpdir(), "oab-desktop-e2e");
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, `${label}-`));
}

export function shellEnv(o: ShellEnv): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "",
    TMPDIR: process.env.TMPDIR ?? "/tmp",
    OPEN_AGENT_SHELL_TEST: "1",
    OPEN_AGENT_SHELL_STATE_DIR: o.stateDir,
    OPEN_AGENT_SHELL_PROJECT: o.project,
    OPEN_AGENT_SHELL_DATA_VOLUME: `${o.project}-data`,
    OPEN_AGENT_SHELL_KEYS_VOLUME: `${o.project}-keys`,
    OPEN_AGENT_SHELL_PORT_RANGE: o.portRange,
    OPEN_AGENT_SHELL_EXTERNAL_LOG: o.externalLog,
    OPEN_AGENT_SHELL_SAVE_PATH: o.savePath,
    ...(o.attachPort ? { OPEN_AGENT_SHELL_ATTACH_PORT: String(o.attachPort) } : {}),
    ...o.extra,
  };
}

export type Shell = Readonly<{
  app: ElectronApplication;
  shellPage(): Promise<Page>;
  appPage(): Promise<Page>;
  log(): string;
  externalLog(): string[];
}>;

const byUrl = async (app: ElectronApplication, prefix: string): Promise<Page> => {
  await expect.poll(() => app.windows().some((p) => p.url().startsWith(prefix)), { timeout: 20_000 }).toBe(true);
  const page = app.windows().find((p) => p.url().startsWith(prefix));
  if (!page) throw new Error(`no window at ${prefix}`);
  return page;
};

export async function launchShell(env: ShellEnv, info: TestInfo): Promise<Shell> {
  if (!existsSync(join(DESKTOP, "dist/main.cjs"))) throw new Error("apps/desktop is not built: run npm run build -w @oab/desktop");
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: [DESKTOP],
    env: shellEnv(env),
    recordVideo: { dir: info.outputPath("video"), size: { width: 1200, height: 800 } },
  });
  return {
    app,
    shellPage: () => byUrl(app, "oa-shell://screens/"),
    appPage: () => byUrl(app, `http://127.0.0.1:${env.attachPort}/`),
    log: () => readIf(join(env.stateDir, "logs/shell.log")),
    externalLog: () => readIf(env.externalLog).split("\n").filter(Boolean),
  };
}

export function seedStack(stateDir: string, o: { project: string; port: number; token: string }): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(stateDir, "stack.json"),
    JSON.stringify({ schema: 1, project: o.project, port: o.port, launchToken: o.token, tokenCreatedAt: new Date().toISOString() }),
    { mode: 0o600 },
  );
}

export function spawnSecondInstance(env: ShellEnv, extraArgs: string[]): ChildProcess {
  return spawn(ELECTRON, [DESKTOP, ...extraArgs], { env: shellEnv(env), stdio: "ignore" });
}

function readIf(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

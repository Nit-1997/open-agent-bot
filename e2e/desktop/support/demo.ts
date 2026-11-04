import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ElectronApplication, expect, type Page } from "@playwright/test";
import { ROOT } from "./fakeDocker";
import { everyElementHasUniqueId } from "./ids";
import type { Shell } from "./launch";
import { DOCKER, dockerEnv, OAB_NAME } from "./real";

export const SLOWMO = Number(process.env.DEMO_SLOWMO ?? 250);
export const DEMO_OUT = process.env.DEMO_OUT ?? join(ROOT, ".factory/m4/demo");

export const say = (m: string) => process.stdout.write(`[demo] ${m}\n`);
export const hold = (page: Page, factor = 4) => page.waitForTimeout(SLOWMO * factor);

const checked = new Set<string>();
export async function ids(page: Page, screen: string): Promise<void> {
  await everyElementHasUniqueId(page);
  checked.add(screen);
}
export const screensChecked = () => [...checked].sort();

export function portOk(port: number, what: string): number {
  if (!Number.isInteger(port) || port < 18000 || port > 19999) throw new Error(`${what} must be a port inside 18000-19999, got ${port}`);
  return port;
}

export function rangeOk(range: string, what: string): string {
  const m = /^(\d+)-(\d+)$/.exec(range);
  if (!m || Number(m[1]) > Number(m[2])) throw new Error(`${what} must be a-b, got ${range}`);
  portOk(Number(m[1]), what);
  portOk(Number(m[2]), what);
  return range;
}

export function nameOk(name: string, what: string): string {
  if (!OAB_NAME.test(name)) throw new Error(`${what} must match ^oab-[a-z0-9-]+$, got ${name}`);
  return name;
}

export type MenuRow = { id: string; label: string };
export const appMenu = (app: ElectronApplication): Promise<MenuRow[]> =>
  app.evaluate(({ Menu }) => (Menu.getApplicationMenu()?.items[0]?.submenu?.items ?? []).map((i) => ({ id: i.id, label: i.label })));
export const clickMenu = (app: ElectronApplication, id: string) =>
  app.evaluate(({ Menu, BaseWindow }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId);
    if (!item) throw new Error(`no menu item ${itemId}`);
    item.click(undefined, BaseWindow.getAllWindows()[0], undefined);
  }, id);

export async function quitWatching(s: Shell, timeout = 90_000): Promise<string[]> {
  const screens: string[] = [];
  const proc = s.app.process();
  const gone = new Promise<void>((res) => {
    if (proc.exitCode !== null) res();
    else proc.once("exit", () => res());
  });
  let done = false;
  void gone.then(() => {
    done = true;
  });
  await s.app.evaluate(({ app }) => {
    setTimeout(() => app.quit(), 0);
  });
  const deadline = Date.now() + timeout;
  while (!done && Date.now() < deadline) {
    const screen = s.status()?.screen;
    if (screen && screens.at(-1) !== screen) screens.push(screen);
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!done) throw new Error(`the app did not exit within ${timeout} ms (screens ${screens.join(" → ")})`);
  await s.app.close().catch(() => {});
  return screens;
}

const MUTATING_DOCKER =
  /\[docker\] (compose .*--ansi never (up|start|stop|down|rm|create|restart|kill|run|pull)\b|(pull|run|rm|kill|stop|start|tag|create)\b|volume rm\b)/;
export const mutatingLines = (log: string) => log.split("\n").filter((l) => MUTATING_DOCKER.test(l));
export const dockerLines = (log: string) => log.split("\n").filter((l) => l.includes("[docker] "));

export function realDocker(args: string[], env: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync(DOCKER, args, { encoding: "utf8", env: { ...dockerEnv, ...env }, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

export function composeDown(o: { project: string; stateDir: string; port: number }): void {
  nameOk(o.project, "project");
  const staged = join(o.stateDir, "stack");
  const file = existsSync(join(staged, "docker-compose.yml")) ? join(staged, "docker-compose.yml") : join(ROOT, "docker-compose.yml");
  const dir = existsSync(join(staged, "docker-compose.yml")) ? staged : ROOT;
  realDocker(
    ["compose", "-p", o.project, "-f", file, "--project-directory", dir, "--env-file", "/dev/null", "down", "-v", "--remove-orphans"],
    {
      OPEN_AGENT_DATA_VOLUME: `${o.project}-data`,
      OPEN_AGENT_KEYS_VOLUME: `${o.project}-keys`,
      OPEN_AGENT_PORT: String(o.port),
    },
  );
  realDocker(["volume", "rm", `${o.project}-data`, `${o.project}-keys`]);
}

export function rememberToken(file: string, token: string | undefined): void {
  if (!token) return;
  const known = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
  if (known.includes(token)) return;
  writeFileSync(file, `${[...known, token].join("\n")}\n`, { mode: 0o600 });
}

export async function waitForFile(path: string, timeout = 60_000): Promise<Buffer> {
  let last = -1;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const size = readFileSync(path).length;
      if (size > 0 && size === last) return readFileSync(path);
      last = size;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${path} did not appear within ${timeout} ms`);
}

export async function captionOn(page: Page, id: string, text: string): Promise<void> {
  await page.evaluate(
    ([i, t]) => {
      const el = document.getElementById(i) ?? document.createElement("div");
      el.id = i;
      el.textContent = t;
      el.setAttribute(
        "style",
        "position:fixed;left:12px;bottom:12px;z-index:99999;padding:8px 12px;background:#111;color:#fff;font:14px monospace;border-radius:6px",
      );
      document.body.append(el);
    },
    [id, text] as const,
  );
  expect(await page.evaluate((i) => document.getElementById(i)?.textContent ?? null, id)).toBe(text);
}

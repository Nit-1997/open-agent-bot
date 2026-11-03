import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ElectronApplication, expect, type Page, test } from "@playwright/test";
import { LATEST_PATH, type MockReleases, startMockReleases } from "../../apps/desktop/test/support/mockReleases.ts";
import { composeSha, createFakeDocker, type FakeDocker, fakeServices, type Recorder, startRecorder, subOf } from "./support/fakeDocker";
import { everyElementHasUniqueId } from "./support/ids";
import { launchShell, newStateDir, type Shell, type ShellEnv } from "./support/launch";

const RANGE = "18440-18441";
const MOCK_PORT = 18445;
const OTHER_PORT = 18444;
const PROJECT = "oab-e2e-desktop-updates";
const PAGE_URL = "https://github.com/Nit-1997/open-agent-bot/releases/tag/v99.0.0";
const NEW_AGENT = `127.0.0.1:18477/oab-m4-agent@sha256:${"c".repeat(64)}`;
const NEW_SEARCH = `127.0.0.1:18477/oab-m4-search@sha256:${"d".repeat(64)}`;
const fp = (t: string) => createHash("sha256").update(t).digest("hex").slice(0, 12);

let env: ShellEnv;
let fake: FakeDocker;
let mock: MockReleases | undefined;
let recorder: Recorder | undefined;
let shell: Shell | undefined;

type MenuRow = { id: string; label: string };
const appMenu = (app: ElectronApplication): Promise<MenuRow[]> =>
  app.evaluate(({ Menu }) => (Menu.getApplicationMenu()?.items[0]?.submenu?.items ?? []).map((i) => ({ id: i.id, label: i.label })));
const clickMenu = (app: ElectronApplication, id: string) =>
  app.evaluate(({ Menu, BaseWindow }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId);
    if (!item) throw new Error(`no menu item ${itemId}`);
    item.click(undefined, BaseWindow.getAllWindows()[0], undefined);
  }, id);
const settingsFile = () => join(env.stateDir, "settings.json");
const settings = () => JSON.parse(readFileSync(settingsFile(), "utf8")) as Record<string, unknown>;
const writeSettings = (v: Record<string, unknown>) => writeFileSync(settingsFile(), JSON.stringify(v), { mode: 0o600 });
const latestHits = () => (mock?.requests() ?? []).filter((r) => r.path === LATEST_PATH).length;

async function readyApp(s: Shell): Promise<Page> {
  const page = await s.appPage();
  await expect.poll(() => s.status()?.screen, { timeout: 40_000 }).toBe("app");
  await expect(page.locator("#fa-heading")).toBeVisible();
  return page;
}

async function openServices(s: Shell): Promise<Page> {
  await clickMenu(s.app, "menu-services");
  return s.waitScreen("screen-services");
}

const release = (tag: string, assets: { name: string; browser_download_url: string }[] = []) => ({
  tag_name: tag,
  html_url: tag === "v99.0.0" ? PAGE_URL : `https://github.com/Nit-1997/open-agent-bot/releases/tag/${tag}`,
  draft: false,
  prerelease: false,
  assets,
});
const manifest = (o: Record<string, unknown> = {}) => ({
  schema: 1,
  kind: "dev",
  version: "0.0.0-b",
  composeSha256: composeSha(),
  images: { agent: NEW_AGENT, search: NEW_SEARCH },
  pull: true,
  minShellVersion: "0.0.0-dev",
  ...o,
});

test.beforeEach(async () => {
  const stateDir = newStateDir("updates");
  fake = await createFakeDocker("updates", { pull: { layers: 5, msPerLayer: 250 } });
  mock = await startMockReleases({ port: MOCK_PORT });
  env = {
    stateDir,
    project: PROJECT,
    portRange: RANGE,
    docker: fake.bin,
    services: fakeServices(stateDir),
    externalLog: join(stateDir, "external.log"),
    savePath: join(stateDir, "saved.bin"),
    extra: { OPEN_AGENT_SHELL_RELEASES_URL: mock.latestUrl },
  };
});

test.afterEach(async () => {
  if (test.info().status !== test.info().expectedStatus) {
    process.stdout.write(
      `--- shell.log\n${shell?.log() ?? ""}\n--- mock\n${(mock?.requests() ?? []).map((r) => r.path).join("\n")}\n--- calls\n${fake
        .calls()
        .map((c) => `${c.argv.slice(c.argv[0] === "compose" ? 11 : 0).join(" ")} => ${c.exitCode}`)
        .join("\n")}\n`,
    );
  }
  await shell?.app.close().catch(() => {});
  shell = undefined;
  await mock?.stop().catch(() => {});
  mock = undefined;
  await recorder?.stop().catch(() => {});
  recorder = undefined;
  await fake.cleanup();
  rmSync(env.stateDir, { recursive: true, force: true });
});

test("v99.0.0 → the menu item and update-row; Download logs the release URL; Later hides it on relaunch; one automatic check per 24 h", async () => {
  if (!mock) throw new Error("no mock");
  mock.redirect(LATEST_PATH, "/hop-1");
  mock.redirect("/hop-1", "/hop-2", 307);
  mock.route("/hop-2", { status: 200, body: JSON.stringify(release("v99.0.0")) });

  shell = await launchShell(env, test.info(), { video: "new-version" });
  await readyApp(shell);
  const app = shell.app;
  await expect
    .poll(async () => (await appMenu(app)).find((i) => i.id === "menu-update")?.label, { timeout: 15_000 })
    .toBe("Open Agent 99.0.0 is available…");
  const menu = await appMenu(app);
  expect(menu.findIndex((i) => i.id === "menu-update")).toBe(menu.findIndex((i) => i.id === "menu-services") - 1);
  expect(mock.requests().map((r) => r.path)).toEqual([LATEST_PATH, "/hop-1", "/hop-2"]);
  expect(mock.requests()[0]?.headers["user-agent"]).toMatch(/^OpenAgent\//);
  expect(mock.requests()[0]?.headers.accept).toBe("application/vnd.github+json");
  expect(mock.requests().every((r) => r.headers.cookie === undefined)).toBe(true);
  expect(typeof settings().lastUpdateCheck).toBe("string");

  await clickMenu(app, "menu-update");
  const page = await shell.waitScreen("screen-services");
  await expect(page.locator("#update-row")).toBeVisible();
  await expect(page.locator("#update-row-text")).toHaveText("Open Agent 99.0.0 is available");
  await expect(page.locator("#update-row")).toBeInViewport();
  await expect(page.locator("#screen-services-about-app-value")).toHaveText("0.0.0-dev");
  await everyElementHasUniqueId(page);

  await page.click("#update-row-download");
  await expect.poll(() => shell?.externalLog()).toEqual([PAGE_URL]);

  await page.click("#update-row-later");
  await expect.poll(() => settings().dismissedVersion).toBe("99.0.0");
  await expect(page.locator("#update-row-later")).toHaveCount(0);
  await expect(page.locator("#update-row-download")).toBeVisible();
  await expect.poll(async () => (await appMenu(app)).some((i) => i.id === "menu-update")).toBe(false);
  await everyElementHasUniqueId(page);
  await page.click("#screen-services-back");
  await expect.poll(() => shell?.status()?.screen).toBe("app");

  await shell.app.close();
  shell = undefined;
  const hits = latestHits();
  shell = await launchShell(env, test.info(), { video: "throttled" });
  await readyApp(shell);
  await shell.app.evaluate(() => new Promise((r) => setTimeout(r, 1500)));
  expect(latestHits()).toBe(hits);
  expect(shell.log()).toContain("[update] automatic check skipped (checked within 24 h)");
  expect((await appMenu(shell.app)).some((i) => i.id === "menu-update")).toBe(false);
  await shell.app.close();
  shell = undefined;

  const { lastUpdateCheck: _drop, ...rest } = settings();
  writeSettings(rest);
  shell = await launchShell(env, test.info(), { video: "dismissed" });
  await readyApp(shell);
  await expect.poll(() => latestHits(), { timeout: 15_000 }).toBe(hits + 1);
  await expect.poll(() => shell?.log().includes("[update] found app 99.0.0")).toBe(true);
  expect((await appMenu(shell.app)).some((i) => i.id === "menu-update")).toBe(false);
});

test("a services manifest with a new dev digest → Update services (0.0.0-b available) → pull progress → recreate → the version changes and stays", async () => {
  if (!mock) throw new Error("no mock");
  fake.scenario({ versions: { agent: "0.0.0-a", search: "0.0.0-a" }, refVersions: { [NEW_AGENT]: "0.0.0-b", [NEW_SEARCH]: "0.0.0-b" } });
  env = { ...env, services: fakeServices(env.stateDir, { version: "0.0.0-a" }) };
  const asset = mock.asset("open-agent-services.json", manifest());
  mock.release(release("v0.0.0-b", [{ name: "open-agent-services.json", browser_download_url: asset }]));

  shell = await launchShell(env, test.info(), { video: "service-update" });
  await readyApp(shell);
  const first = shell.stack()?.launchToken ?? "";
  await expect.poll(() => shell?.log().includes("[update] found services 0.0.0-b"), { timeout: 15_000 }).toBe(true);
  expect((await appMenu(shell.app)).some((i) => i.id === "menu-update")).toBe(false);

  const page = await openServices(shell);
  await expect(page.locator("#screen-services-about-services-value")).toHaveText("0.0.0-a");
  await expect(page.locator("#screen-services-services-update-update")).toHaveText("Update services (0.0.0-b available)");
  await everyElementHasUniqueId(page);
  const before = fake.calls().length;
  await page.click("#screen-services-services-update-update");

  const seen = new Set<string>();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && shell.status()?.screen !== "app") {
    const t = await page
      .locator("#screen-progress-download-detail")
      .textContent({ timeout: 300 })
      .catch(() => null);
    if (t && /layer \d+ of \d+/.test(t)) seen.add(t);
    await page.waitForTimeout(100);
  }
  expect(seen.size, [...seen].join(" | ")).toBeGreaterThanOrEqual(2);
  const appPage = await readyApp(shell);
  expect(await appPage.evaluate(() => fetch("/health").then((r) => r.json()))).toMatchObject({ version: "0.0.0-b" });

  const after = fake.calls().slice(before);
  expect(after.filter((c) => c.argv[0] === "pull").map((c) => c.argv[1])).toEqual([NEW_AGENT, NEW_SEARCH]);
  const ups = after.filter((c) => subOf(c) === "up");
  expect(ups).toHaveLength(1);
  expect(ups[0]?.argv).toContain("--force-recreate");
  expect(ups[0]?.images).toEqual({ agent: NEW_AGENT, search: NEW_SEARCH });
  expect(ups[0]?.tokenFp).toBe(fp(shell.stack()?.launchToken ?? ""));
  expect(shell.stack()?.launchToken).not.toBe(first);

  const saved = join(env.stateDir, "services.json");
  expect(statSync(saved).mode & 0o777).toBe(0o600);
  expect(JSON.parse(readFileSync(saved, "utf8"))).toMatchObject({ schema: 1, replaced: "0.0.0-a", manifest: { version: "0.0.0-b" } });

  const again = await openServices(shell);
  await expect(again.locator("#screen-services-about-services-value")).toHaveText("0.0.0-b");
  await expect(again.locator("#screen-services-services-update")).toHaveText("Up to date (0.0.0-b)");
  await everyElementHasUniqueId(again);

  await shell.app.close();
  shell = undefined;
  const quitAt = fake.calls().length;
  shell = await launchShell(env, test.info(), { video: "service-update-relaunch" });
  await readyApp(shell);
  const relaunch = fake.calls().slice(quitAt);
  expect(relaunch.filter((c) => subOf(c) === "up")).toHaveLength(0);
  expect(relaunch.filter((c) => c.argv[0] === "pull")).toHaveLength(0);
  expect(shell.log()).toContain("[stack] classify oursStopped");
});

test("an incompatible manifest (another composeSha256) shows its reason and is never applied", async () => {
  if (!mock) throw new Error("no mock");
  const asset = mock.asset("open-agent-services.json", manifest({ composeSha256: "0".repeat(64) }));
  mock.release(release("v0.0.0-b", [{ name: "open-agent-services.json", browser_download_url: asset }]));
  shell = await launchShell(env, test.info(), { video: "incompatible" });
  await readyApp(shell);
  await expect
    .poll(() => shell?.log().includes("[update] services manifest incompatible: compose_mismatch"), { timeout: 15_000 })
    .toBe(true);
  const page = await openServices(shell);
  await expect(page.locator("#screen-services-services-update")).toHaveText(
    "Service update not compatible: it needs a different compose file; update Open Agent first (compose_mismatch)",
  );
  await expect(page.locator("#screen-services-services-update-update")).toHaveCount(0);
  await everyElementHasUniqueId(page);
  await page.waitForTimeout(1000);
  const refs = fake.calls().flatMap((c) => [...c.argv, c.images?.agent ?? "", c.images?.search ?? ""]);
  expect(refs).not.toContain(NEW_AGENT);
  expect(refs).not.toContain(NEW_SEARCH);
  expect(existsSync(join(env.stateDir, "services.json"))).toBe(false);
});

test("offline: no menu item and no dialog; Couldn't check appears only after a manual check", async () => {
  if (!mock) throw new Error("no mock");
  await mock.stop();
  mock = undefined;
  shell = await launchShell(env, test.info(), { video: "offline" });
  await readyApp(shell);
  await expect.poll(() => shell?.log().includes("[update] check failed reason=offline (automatic)"), { timeout: 15_000 }).toBe(true);
  expect((await appMenu(shell.app)).some((i) => i.id === "menu-update")).toBe(false);
  const windows = await shell.app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length);
  expect(windows).toBe(1);

  const page = await openServices(shell);
  await expect(page.locator("#screen-services-check-text")).toHaveText("");
  await expect(page.locator("#update-row")).toHaveCount(0);
  await page.click("#screen-services-check-check");
  await expect(page.locator("#screen-services-check-text")).toHaveText("Couldn't check: offline");
  await everyElementHasUniqueId(page);
  expect(await shell.app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length)).toBe(1);
});

test("check turned off → zero requests; a manual check redirected to another origin is refused without reaching it", async () => {
  if (!mock) throw new Error("no mock");
  recorder = await startRecorder(OTHER_PORT);
  writeSettings({ schema: 1, stopOnQuit: true, checkForUpdates: false });
  mock.redirect(LATEST_PATH, `http://127.0.0.1:${OTHER_PORT}/latest`);
  shell = await launchShell(env, test.info(), { video: "disabled" });
  await readyApp(shell);
  await shell.app.evaluate(() => new Promise((r) => setTimeout(r, 2000)));
  expect(mock.requests()).toEqual([]);
  expect(shell.log()).toContain("[update] automatic check skipped (turned off)");
  expect(settings().lastUpdateCheck).toBeUndefined();

  const page = await openServices(shell);
  await page.click("#screen-services-check-check");
  await expect(page.locator("#screen-services-check-text")).toHaveText("Couldn't check: redirect_refused");
  expect(mock.requests().map((r) => r.path)).toEqual([LATEST_PATH]);
  expect(recorder.hits()).toBe(0);
  await everyElementHasUniqueId(page);

  await clickMenu(shell.app, "menu-check-updates");
  await expect.poll(() => mock?.requests().length).toBe(2);
  await expect(page.locator("#screen-services-check-text")).toHaveText("Couldn't check: redirect_refused");
});

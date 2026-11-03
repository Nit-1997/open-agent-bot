import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { DESKTOP, ROOT } from "./support/fakeDocker";
import { everyElementHasUniqueId } from "./support/ids";
import { launchShell, newStateDir, type Shell, type ShellEnv } from "./support/launch";
import { DOCKER, docker, dockerEnv, firstPort, OAB_NAME, projectStates, REAL, shellExtra, tearDown } from "./support/real";

const PROJECT = `${process.env.DESKTOP_REAL_PROJECT ?? "oab-factory-m4-5-real"}-lb`;
const RANGE = process.env.DESKTOP_LOCAL_RANGE ?? process.env.DESKTOP_REAL_RANGE ?? "18484-18485";
const PREFIX = process.env.DESKTOP_LOCAL_PREFIX ?? "oab-m4-";
const EVIDENCE = process.env.DESKTOP_REAL_EVIDENCE ?? join(process.cwd(), "..", ".factory/m4/4.5/real");
const PORT = firstPort(RANGE);
const AGENT = `${PREFIX}open-agent:local`;
const SEARCH = `${PREFIX}open-agent-search:local`;

test.skip(!REAL, "real Docker only with DESKTOP_REAL_DOCKER=1");
test.skip(!OAB_NAME.test(PROJECT) || !/^oab-[a-z0-9-]*-$/.test(PREFIX), "test names must be oab-*");

type Lock = { kind: string; version: string; images: { agent: string; search: string }; imageIds: { agent: string; search: string } };

const say = (m: string) => process.stdout.write(`[local-build] ${m}\n`);
let env: ShellEnv;
let shell: Shell | undefined;
let agentId = "";

test.afterEach(async () => {
  await shell?.app.close().catch(() => {});
  shell = undefined;
  if (agentId) docker(["tag", agentId, AGENT]);
  if (env) {
    for (const [from, to] of [
      ["logs/shell.log", "local-build-shell.log"],
      ["status.json", "local-build-status.json"],
    ]) {
      const p = join(env.stateDir, from);
      if (existsSync(p)) copyFileSync(p, join(EVIDENCE, to));
    }
    tearDown({ project: PROJECT, stateDir: env.stateDir, port: PORT });
  }
});

const appReady = async (s: Shell, timeout = 300_000): Promise<Page> => {
  await expect.poll(() => s.status()?.screen, { timeout, intervals: [500] }).toBe("app");
  return s.appPage();
};

test("dist:local: a kind:local lock from the script → the Local build badge and title → healthy; a rebuilt image → local_images_changed with no compose call", async () => {
  test.setTimeout(1_800_000);
  mkdirSync(EVIDENCE, { recursive: true });
  const stateDir = newStateDir("local-build");
  const lockFile = join(stateDir, "local.services.lock.json");
  const build = spawnSync(
    process.execPath,
    [join(DESKTOP, "scripts/local-build.mjs"), "--tag-prefix", PREFIX, "--lock-out", lockFile, "--no-dist", "--docker", DOCKER],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...dockerEnv, OPEN_AGENT_SHELL_TEST: "1" }, maxBuffer: 256 * 1024 * 1024 },
  );
  say(`local-build.mjs exited ${build.status}; last lines:\n${build.stdout.split("\n").slice(-6).join("\n")}`);
  expect(build.status, build.stderr.slice(-4000)).toBe(0);
  const lock = JSON.parse(readFileSync(lockFile, "utf8")) as Lock;
  say(`lock: kind=${lock.kind} version=${lock.version} agent=${lock.images.agent} search=${lock.images.search}`);
  expect(lock.kind).toBe("local");
  expect(lock.version).toMatch(/^local-[0-9a-f]{7,12}(-dirty)?$/);
  expect(lock.images).toEqual({ agent: AGENT, search: SEARCH });
  expect(lock.imageIds.agent).toBe(docker(["image", "inspect", "-f", "{{.Id}}", AGENT]).trim());
  agentId = lock.imageIds.agent;
  expect(docker(["image", "inspect", "-f", '{{index .Config.Labels "org.opencontainers.image.version"}}', AGENT]).trim()).toBe(
    lock.version,
  );

  env = {
    stateDir,
    project: PROJECT,
    portRange: RANGE,
    docker: DOCKER,
    services: lockFile,
    externalLog: join(stateDir, "external.log"),
    savePath: join(stateDir, "saved.bin"),
    extra: shellExtra(),
  };
  const badge = `Local build (${lock.version})`;
  shell = await launchShell(env, test.info(), { video: "local-build-1" });
  const s1 = shell;
  const shellPage = await s1.shellPage();
  await expect(shellPage.locator("#screen-progress-badge")).toHaveText(badge, { timeout: 60_000 });
  await everyElementHasUniqueId(shellPage);
  const title = () => s1.app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]?.getTitle());
  await expect.poll(title, { timeout: 15_000 }).toBe("Open Agent — Local build — test");
  expect(s1.log()).toContain("[app] title Open Agent — Local build — test");
  say(`window title: ${await title()}; progress badge: ${badge}`);
  const page = await appReady(s1);
  await expect(page.locator("#onboarding-step")).toBeVisible({ timeout: 60_000 });
  const health = (await page.evaluate(() => fetch("/health").then((r) => r.json()))) as { version: string };
  say(`healthy; /health.version ${health.version}`);
  expect(health.version).toBe(lock.version);
  expect(s1.log()).not.toMatch(/\[docker\] pull /);

  await s1.app.evaluate(({ Menu, BaseWindow }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById("menu-services");
    if (!item) throw new Error("no menu item menu-services");
    item.click(undefined, BaseWindow.getAllWindows()[0], undefined);
  });
  const sp = await s1.waitScreen("screen-services", 30_000);
  await expect(sp.locator("#screen-services-badge")).toHaveText(badge);
  await expect(sp.locator("#screen-services-update")).toHaveText("Not available for local builds");
  await expect(sp.locator("#screen-services-update")).toBeDisabled();
  await everyElementHasUniqueId(sp);
  say(
    `Services & data: badge "${await sp.locator("#screen-services-badge").innerText()}", update "${await sp.locator("#screen-services-update").innerText()}"`,
  );
  await shell.app.close();
  shell = undefined;
  expect(projectStates(PROJECT)).toEqual(["agent=exited", "renderer=exited", "search=exited"]);

  docker(["tag", SEARCH, AGENT]);
  say(`docker tag ${SEARCH} ${AGENT}: the agent ref now points at another image`);
  const before = (readFileSync(join(stateDir, "logs/shell.log"), "utf8").match(/\n/g) ?? []).length;
  shell = await launchShell(env, test.info(), { video: "local-build-2" });
  const failed = await shell.waitScreen("screen-failed", 120_000);
  await expect(failed.locator("#screen-failed-reason")).toHaveText("Reason: local_images_changed");
  await expect(failed.locator("#screen-failed-detail")).toContainText("Rebuild with npm run dist:local");
  await everyElementHasUniqueId(failed);
  expect(shell.status()?.screen).toBe("screen-failed");
  const tail = readFileSync(join(stateDir, "logs/shell.log"), "utf8").split("\n").slice(before);
  const composeLines = tail.filter((l) => /\[docker\] compose /.test(l) && !/\[docker\] compose version/.test(l));
  say(`after the retag: ${composeLines.length} compose calls; ${tail.filter((l) => l.includes("[docker]")).length} docker lines`);
  expect(composeLines).toEqual([]);
});

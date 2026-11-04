import { createHash } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createFakeDocker, type FakeDocker, type FakeScenario, fakeServices, subOf } from "./support/fakeDocker";
import { everyElementHasUniqueId } from "./support/ids";
import { launchShell, newStateDir, type Shell, type ShellEnv } from "./support/launch";

const RANGE = "18425-18425";
const PROJECT = "oab-e2e-desktop-failures";
const fp = (t: string) => createHash("sha256").update(t).digest("hex").slice(0, 12);

let env: ShellEnv;
let fake: FakeDocker;
let shell: Shell | undefined;

const setup = async (scenario: FakeScenario) => {
  const stateDir = newStateDir("failures");
  fake = await createFakeDocker("failures", { pull: { layers: 1, msPerLayer: 10 }, ...scenario });
  env = {
    stateDir,
    project: PROJECT,
    portRange: RANGE,
    docker: fake.bin,
    services: fakeServices(stateDir),
    externalLog: join(stateDir, "external.log"),
    savePath: join(stateDir, "saved.bin"),
  };
};
const launch = async (video: string) => {
  shell = await launchShell(env, test.info(), { video });
  return shell;
};
const ready = async (s: Shell): Promise<Page> => {
  await expect.poll(() => s.status()?.screen, { timeout: 40_000 }).toBe("app");
  const page = await s.appPage();
  await expect(page.locator("#fa-heading")).toBeVisible();
  return page;
};
const cookieCount = (s: Shell) =>
  s.app.evaluate(async ({ session }) => (await session.fromPartition("persist:open-agent").cookies.get({ name: "oa_launch" })).length);
const ups = () => fake.calls().filter((c) => subOf(c) === "up");
const starts = () => fake.calls().filter((c) => c.argv[0] === "compose" && subOf(c) === "start");

test.afterEach(async () => {
  if (test.info().status !== test.info().expectedStatus) process.stdout.write(`--- shell.log\n${shell?.log() ?? ""}\n`);
  await shell?.app.close().catch(() => {});
  shell = undefined;
  await fake.cleanup();
  rmSync(env.stateDir, { recursive: true, force: true });
});

test("Docker quits after ready: the first failure closes the origin, then services-stopped, then back by itself with up and a new token", async () => {
  test.setTimeout(150_000);
  await setup({ afterReady: "daemonDown", afterReadyMs: 1500 });
  const s = await launch("daemon-down");
  const page = await ready(s);
  const first = s.stack()?.launchToken ?? "";
  await expect.poll(() => cookieCount(s), { timeout: 20_000 }).toBe(0);
  expect(s.log()).toContain("[watchdog] health failed; app origin closed and launch cookie removed");
  const blocked = await page.evaluate(() =>
    fetch("/api/whoami").then(
      (r) => `status ${r.status}`,
      (e: Error) => `failed ${e.name}`,
    ),
  );
  expect(blocked).toBe("failed TypeError");
  const shellPage = await s.waitScreen("screen-services-stopped", 40_000);
  await expect(shellPage.locator("#screen-services-stopped-title")).toHaveText("Docker stopped");
  await everyElementHasUniqueId(shellPage);
  const startsBefore = starts().length;
  fake.daemon("up");
  await expect.poll(() => s.status()?.screen, { timeout: 30_000 }).toBe("app");
  expect(starts().length).toBe(startsBefore);
  expect(ups()).toHaveLength(2);
  expect(ups()[1]?.argv).toContain("--force-recreate");
  const second = s.stack()?.launchToken ?? "";
  expect(fp(second)).not.toBe(fp(first));
  expect(ups()[1]?.tokenFp).toBe(fp(second));
  const log = s.log();
  const tail = log.slice(log.lastIndexOf("[docker] engine is back"));
  expect(tail.indexOf("[stack] port check ok")).toBeGreaterThan(0);
  expect(tail.indexOf("[stack] port check ok")).toBeLessThan(tail.indexOf("[app] cookie installed"));
  expect(await cookieCount(s)).toBe(1);
  for (const t of [first, second]) expect(log).not.toContain(t);
});

test("the agent exits after ready → services-stopped with the exit code and log tail → Restart services recovers", async () => {
  test.setTimeout(150_000);
  await setup({ afterReady: "agentExit:1", afterReadyMs: 1500 });
  const s = await launch("agent-exit");
  await ready(s);
  const page = await s.waitScreen("screen-services-stopped", 45_000);
  await expect(page.locator("#screen-services-stopped-title")).toHaveText("Open Agent's services stopped");
  await expect(page.locator("#screen-services-stopped-reason")).toHaveText("Reason: crashed, exit code 1");
  await expect(page.locator("#screen-services-stopped-tail")).toContainText("fatal: exiting with 1");
  await everyElementHasUniqueId(page);
  await page.click("#screen-services-stopped-restart");
  await ready(s);
  expect(ups().at(-1)?.argv).toContain("--force-recreate");
  expect(starts()).toHaveLength(0);
});

test("the agent exits 82 after ready → screen-refusal-kek_missing", async () => {
  test.setTimeout(150_000);
  await setup({ afterReady: "agentExit:82", afterReadyMs: 1500 });
  const s = await launch("agent-82");
  await ready(s);
  const page = await s.waitScreen("screen-refusal-kek_missing", 45_000);
  await expect(page.locator("#screen-refusal-kek_missing-line")).toContainText("[startup] refused code=kek_missing");
  await everyElementHasUniqueId(page);
});

test("renderer crashes: one automatic reload, a second within 60 s → screen-failed ui_crashed → Reload", async () => {
  await setup({});
  const s = await launch("ui-crash");
  await ready(s);
  const crash = () =>
    s.app.evaluate(({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith("http://127.0.0.1:"));
      wc?.forcefullyCrashRenderer();
    });
  const heading = () =>
    s.app.evaluate(async ({ webContents }) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().startsWith("http://127.0.0.1:"));
      if (!wc || wc.isCrashed() || wc.isLoading()) return null;
      return wc.executeJavaScript("document.getElementById('fa-heading')?.textContent ?? null");
    });
  await crash();
  await expect.poll(() => s.log()).toContain("[app] app reloaded after renderer crash");
  await expect.poll(() => s.status()?.screen).toBe("app");
  await expect.poll(heading, { timeout: 15_000 }).toMatch(/^Fake agent on/);
  await crash();
  const page = await s.waitScreen("screen-failed");
  await expect(page.locator("#screen-failed-title")).toHaveText("The Open Agent window crashed");
  await everyElementHasUniqueId(page);
  await page.click("#screen-failed-reload");
  await expect.poll(() => s.status()?.screen, { timeout: 30_000 }).toBe("app");
  await expect.poll(heading, { timeout: 15_000 }).toMatch(/^Fake agent on/);
});

test("an exception in the main process → screen-failed internal_error and a logged stack", async () => {
  await setup({});
  const s = await launch("internal");
  await ready(s);
  await s.app.evaluate(() => {
    setTimeout(() => {
      throw new Error("injected main-process failure");
    }, 0);
  });
  const page = await s.waitScreen("screen-failed");
  await expect(page.locator("#screen-failed-title")).toHaveText("Something went wrong inside Open Agent");
  await expect(page.locator("#screen-failed-relaunch")).toBeVisible();
  await expect.poll(() => s.log()).toMatch(/\[app\] uncaught Error: injected main-process failure\\n\s+at /);
  await everyElementHasUniqueId(page);
});

test("a plain 401 is ignored; a probe 401 launch_required → screen-failed launch_mismatch → Restart services fixes it", async () => {
  await setup({});
  const s = await launch("flaky401");
  const page = await ready(s);
  expect(await page.evaluate(() => fetch("/api/flaky401").then((r) => r.status))).toBe(401);
  await expect.poll(() => s.log()).toContain("[app] probe status=200; ignored");
  expect(s.status()?.screen).toBe("app");
  await s.app.close();
  shell = undefined;
  await fake.cleanup();
  rmSync(env.stateDir, { recursive: true, force: true });

  await setup({ agent: "mismatch" });
  const s2 = await launch("mismatch");
  const page2 = await ready(s2);
  expect(await page2.evaluate(() => fetch("/api/chats").then((r) => r.status))).toBe(401);
  const failed = await s2.waitScreen("screen-failed");
  await expect(failed.locator("#screen-failed-title")).toHaveText("The services were started with a different key");
  await everyElementHasUniqueId(failed);
  fake.scenario({ agent: "healthy" });
  await failed.click("#screen-failed-restart");
  const page3 = await ready(s2);
  expect(await page3.evaluate(() => fetch("/api/chats").then((r) => r.status))).toBe(200);
});

test("quit during a slow pull: the pull child is gone and no up was called", async () => {
  await setup({ slow: { pullMs: 30_000 } });
  const s = await launch("quit-pull");
  await expect.poll(() => s.status()?.phase, { timeout: 20_000 }).toBe("pulling");
  await expect.poll(() => fake.started().some((c) => c.argv[0] === "pull"), { timeout: 20_000 }).toBe(true);
  await s.app.close();
  shell = undefined;
  const pull = fake.calls().find((c) => c.argv[0] === "pull");
  expect(pull?.signal).toBe("SIGTERM");
  expect(() => process.kill(pull?.pid ?? 0, 0)).toThrow();
  expect(ups()).toHaveLength(0);
});

test("quit during a slow up: compose stop is recorded and the next launch classifies the stack as ours", async () => {
  await setup({ slow: { upMs: 30_000 } });
  writeFileSync(join(env.stateDir, "settings.json"), JSON.stringify({ schema: 1, stopOnQuit: false, checkForUpdates: true }), {
    mode: 0o600,
  });
  const s = await launch("quit-up");
  await expect.poll(() => s.status()?.phase, { timeout: 20_000 }).toBe("creating");
  await expect.poll(() => fake.started().some((c) => subOf(c) === "up"), { timeout: 20_000 }).toBe(true);
  await s.app.close();
  shell = undefined;
  const calls = fake.calls();
  expect(calls.find((c) => subOf(c) === "up")?.signal).toBe("SIGTERM");
  expect(calls.filter((c) => subOf(c) === "stop").map((c) => c.argv.slice(11))).toEqual([["stop"]]);
  fake.scenario({ slow: {} });
  const s2 = await launch("quit-up-next");
  await ready(s2);
  expect(s2.log()).toMatch(/\[stack\] classify (oursStopped|oursStale)/);
});

test("stack.json deleted while the stack runs → oursStale(token_mismatch) → recreate with a new token, no foreign screen", async () => {
  await setup({});
  writeFileSync(join(env.stateDir, "settings.json"), JSON.stringify({ schema: 1, stopOnQuit: false, checkForUpdates: true }), {
    mode: 0o600,
  });
  const s = await launch("stale-1");
  await ready(s);
  const first = s.stack()?.launchToken ?? "";
  await s.app.close();
  shell = undefined;
  rmSync(join(env.stateDir, "stack.json"));
  const s2 = await launch("stale-2");
  await ready(s2);
  expect(s2.log()).toContain("[stack] stale: token_mismatch");
  expect(s2.log()).not.toContain("foreign");
  expect(ups()).toHaveLength(2);
  expect(ups()[1]?.argv).toContain("--force-recreate");
  expect(fp(s2.stack()?.launchToken ?? "")).not.toBe(fp(first));
});

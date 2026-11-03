import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  type CallRecord,
  createFakeDocker,
  type FakeDocker,
  fakeServices,
  isMutating,
  ROOT,
  startRecorder,
  subOf,
} from "./support/fakeDocker";
import { everyElementHasUniqueId } from "./support/ids";
import { launchShell, newStateDir, type Shell, type ShellEnv } from "./support/launch";

const RANGE = "18421-18422";
const PROJECT = "oab-e2e-desktop-lifecycle";
const fp = (t: string) => createHash("sha256").update(t).digest("hex").slice(0, 12);

let env: ShellEnv;
let fake: FakeDocker;
let shell: Shell | undefined;

const ups = (calls: CallRecord[]) => calls.filter((c) => subOf(c) === "up");
const starts = (calls: CallRecord[]) => calls.filter((c) => c.argv[0] === "compose" && subOf(c) === "start");
const stops = (calls: CallRecord[]) => calls.filter((c) => c.argv[0] === "compose" && subOf(c) === "stop");

async function readyApp(s: Shell): Promise<Page> {
  const page = await s.appPage();
  await expect.poll(() => s.status()?.screen, { timeout: 40_000 }).toBe("app");
  await expect(page.locator("#fa-heading")).toBeVisible();
  return page;
}

test.beforeEach(async () => {
  const stateDir = newStateDir("lifecycle");
  fake = await createFakeDocker("lifecycle", { pull: { layers: 6, msPerLayer: 350 } });
  env = {
    stateDir,
    project: PROJECT,
    portRange: RANGE,
    docker: fake.bin,
    services: fakeServices(stateDir),
    externalLog: join(stateDir, "external.log"),
    savePath: join(stateDir, "saved.bin"),
    extra: { COMPOSE_PROJECT_NAME: "evil", COMPOSE_FILE: "/tmp/evil.yml", OPEN_AGENT_IMAGE: "evil:latest" },
  };
});

test.afterEach(async () => {
  if (test.info().status !== test.info().expectedStatus) {
    process.stdout.write(
      `--- shell.log\n${shell?.log() ?? ""}\n--- calls\n${fake
        .calls()
        .map((c) => `${c.argv.slice(c.argv[0] === "compose" ? 11 : 0).join(" ")} => ${c.exitCode}`)
        .join("\n")}\n`,
    );
  }
  await shell?.app.close().catch(() => {});
  shell = undefined;
  await fake.cleanup();
  rmSync(env.stateDir, { recursive: true, force: true });
});

test("fresh start: layer counts rise, the app loads with the cookie, stop-on-quit stops, a relaunch only starts and keeps the token", async () => {
  shell = await launchShell(env, test.info(), { video: "fresh" });
  const shellPage = await shell.shellPage();
  const seen = new Set<string>();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && shell.status()?.screen !== "app") {
    const t = await shellPage
      .locator("#screen-progress-download-detail")
      .textContent({ timeout: 500 })
      .catch(() => null);
    if (t && /layer \d+ of \d+|MB of|GB of/.test(t)) seen.add(t);
    await everyElementHasUniqueId(shellPage).catch(() => {});
    await shellPage.waitForTimeout(120);
  }
  expect(seen.size, [...seen].join(" | ")).toBeGreaterThanOrEqual(3);
  const page = await readyApp(shell);
  expect(await page.evaluate(() => fetch("/api/whoami").then((r) => r.status))).toBe(200);
  const first = shell.stack();
  expect(first?.launchToken).toMatch(/^[0-9a-f]{64}$/);
  expect(first?.port).toBe(18421);
  const log = shell.log();
  expect(log.indexOf("[stack] port check ok 127.0.0.1:18421")).toBeGreaterThan(0);
  expect(log.indexOf("[stack] port check ok")).toBeLessThan(log.indexOf("[app] cookie installed"));
  expect(log).toContain(`[stack] staged`);

  const calls = fake.calls();
  for (const c of calls) {
    expect(c.envNames.filter((n) => n.startsWith("COMPOSE_"))).toEqual([]);
    if (c.argv[0] === "compose" && c.argv[1] !== "version") {
      expect(c.argv.slice(0, 11)).toEqual([
        "compose",
        "-p",
        PROJECT,
        "-f",
        join(env.stateDir, "stack/docker-compose.yml"),
        "--project-directory",
        join(env.stateDir, "stack"),
        "--env-file",
        "/dev/null",
        "--ansi",
        "never",
      ]);
      expect(c.argv).not.toContain("build");
      expect(c.images?.agent).toBe(`127.0.0.1:18467/oab-fake-agent@sha256:${"a".repeat(64)}`);
    }
  }
  const up = ups(calls);
  expect(up).toHaveLength(1);
  expect(up[0]?.argv.slice(11)).toEqual(["up", "-d", "--no-build", "--pull", "never", "--remove-orphans"]);
  expect(up[0]?.tokenFp).toBe(fp(first?.launchToken ?? ""));

  await shell.app.close();
  shell = undefined;
  expect(stops(fake.calls())).toHaveLength(1);
  const before = fake.calls().length;

  shell = await launchShell(env, test.info(), { video: "relaunch" });
  await readyApp(shell);
  const after = fake.calls().slice(before);
  expect(ups(after)).toHaveLength(0);
  expect(starts(after)).toHaveLength(1);
  expect(shell.stack()?.launchToken).toBe(first?.launchToken);
  expect(starts(after)[0]?.tokenFp).toBe(fp(first?.launchToken ?? ""));

  writeFileSync(join(env.stateDir, "settings.json"), JSON.stringify({ schema: 1, stopOnQuit: false, checkForUpdates: true }), {
    mode: 0o600,
  });
  await shell.app.close();
  shell = undefined;
  const afterQuit = fake.calls().length;
  expect(stops(fake.calls().slice(after.length + before))).toHaveLength(0);
  expect(fake.state().containers[PROJECT]?.agent?.status).toBe("running");

  shell = await launchShell(env, test.info(), { video: "attach" });
  const page3 = await readyApp(shell);
  expect(fake.calls().slice(afterQuit).filter(isMutating)).toEqual([]);
  expect(shell.stack()?.launchToken).toBe(first?.launchToken);
  expect(await page3.evaluate(() => fetch("/api/chats").then((r) => r.status))).toBe(200);
  for (const t of [first?.launchToken ?? "x"]) {
    expect(shell.log()).not.toContain(t);
    expect(readFileSync(join(fake.home, "calls.jsonl"), "utf8")).not.toContain(t);
    expect(readFileSync(join(env.stateDir, "status.json"), "utf8")).not.toContain(t);
  }
});

test("a foreign stack waits for the user: no mutation until Use the app's services, then up with a new token", async () => {
  fake.writeState({
    images: {},
    containers: {
      [PROJECT]: Object.fromEntries(
        ["search", "agent", "renderer"].map((svc) => [
          svc,
          {
            id: createHash("sha256").update(svc).digest("hex"),
            name: `${PROJECT}-${svc}-1`,
            service: svc,
            project: PROJECT,
            image: "open-agent:local",
            imageId: `sha256:${"c".repeat(64)}`,
            configFiles: join(ROOT, "docker-compose.yml"),
            workingDir: ROOT,
            version: "0.0.0-repo",
            status: "running",
            health: "healthy",
            exitCode: 0,
            logs: [],
            ...(svc === "agent"
              ? { token: "f".repeat(64), port: 18468, dataVolume: `${PROJECT}-data`, keysVolume: `${PROJECT}-keys` }
              : {}),
          },
        ]),
      ),
    },
  });
  shell = await launchShell(env, test.info(), { video: "foreign" });
  const page = await shell.waitScreen("screen-foreign-stack");
  await expect(page.locator("#screen-foreign-stack-details-dir-value")).toHaveText(ROOT);
  await expect(page.locator("#screen-foreign-stack-details-port-value")).toHaveText("18468");
  await expect(page.locator("#screen-foreign-stack-details-volumes-value")).toHaveText(`${PROJECT}-data · ${PROJECT}-keys`);
  await everyElementHasUniqueId(page);
  await page.waitForTimeout(1500);
  expect(fake.calls().filter(isMutating)).toEqual([]);
  await page.click("#screen-foreign-stack-use");
  await readyApp(shell);
  const up = ups(fake.calls());
  expect(up).toHaveLength(1);
  expect(up[0]?.argv).toContain("--force-recreate");
  expect(up[0]?.tokenFp).toBe(fp(shell.stack()?.launchToken ?? ""));
  expect(up[0]?.tokenFp).not.toBe(fp("f".repeat(64)));
});

test("a listener on the persisted port shows the conflict screen; Pick another port persists the next free one", async () => {
  shell = await launchShell(env, test.info(), { video: "port-1" });
  await readyApp(shell);
  await shell.app.close();
  shell = undefined;
  expect(fake.state().containers[PROJECT]?.agent?.status).toBe("exited");
  fake.writeState({ ...fake.state(), containers: {} });
  const blocker = await startRecorder(18421);
  try {
    shell = await launchShell(env, test.info(), { video: "port-2" });
    const page = await shell.waitScreen("screen-port-conflict");
    await expect(page.locator("#screen-port-conflict-title")).toHaveText("Port 18421 is taken");
    await everyElementHasUniqueId(page);
    await page.click("#screen-port-conflict-pick");
    await readyApp(shell);
    expect(shell.stack()?.port).toBe(18422);
    expect(shell.status()?.port).toBe(18422);
  } finally {
    await blocker.stop();
  }
});

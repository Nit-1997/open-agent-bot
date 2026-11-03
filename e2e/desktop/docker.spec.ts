import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createFakeDocker, type FakeDocker, type FakeScenario, fakeServices, subOf } from "./support/fakeDocker";
import { everyElementHasUniqueId } from "./support/ids";
import { launchShell, newStateDir, type Shell, type ShellEnv } from "./support/launch";

const RANGE = "18423-18423";
const PROJECT = "oab-e2e-desktop-docker";

let env: ShellEnv;
let fake: FakeDocker;
let shell: Shell | undefined;

const setup = async (scenario: FakeScenario, o: { extra?: Record<string, string>; docker?: string; services?: boolean } = {}) => {
  const stateDir = newStateDir("docker");
  fake = await createFakeDocker("docker", scenario);
  env = {
    stateDir,
    project: PROJECT,
    portRange: RANGE,
    docker: o.docker ?? fake.bin,
    ...(o.services === false ? {} : { services: fakeServices(stateDir) }),
    externalLog: join(stateDir, "external.log"),
    savePath: join(stateDir, "saved.bin"),
    extra: o.extra,
  };
};

const launch = async (video: string) => {
  shell = await launchShell(env, test.info(), { video });
  return shell;
};

const composeCalls = () => fake.calls().filter((c) => c.argv[0] === "compose" && c.argv[1] !== "version");

test.afterEach(async () => {
  if (test.info().status !== test.info().expectedStatus) process.stdout.write(`--- shell.log\n${shell?.log() ?? ""}\n`);
  await shell?.app.close().catch(() => {});
  shell = undefined;
  await fake.cleanup();
  rmSync(env.stateDir, { recursive: true, force: true });
});

test("no Docker CLI → the missing screen lists what was searched and the three links reach the external log", async () => {
  const planted = join(newStateDir("planted"), "bin");
  mkdirSync(planted);
  chmodSync(planted, 0o775);
  writeFileSync(join(planted, "docker"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await setup({}, { docker: join(planted, "docker") });
  const s = await launch("missing");
  const page = await s.waitScreen("screen-docker-missing");
  await expect(page.locator("#screen-docker-missing-searched-0")).toHaveText(`Searched ${join(planted, "docker")}`);
  await expect(page.locator("#screen-docker-missing-rejected-0")).toHaveText(
    `Skipped ${join(planted, "docker")}: parent ${planted} is group-writable`,
  );
  await expect(page.locator("#screen-docker-missing-note")).toContainText("OrbStack and Colima are alternatives");
  await everyElementHasUniqueId(page);
  for (const id of ["get-docker-desktop", "get-orbstack", "get-colima"]) {
    await page.click(`#screen-docker-missing-${id}`);
    await page.waitForTimeout(1100);
  }
  expect(s.externalLog()).toEqual([
    "https://www.docker.com/products/docker-desktop/",
    "https://orbstack.dev/",
    "https://github.com/abiosoft/colima",
  ]);
  expect(fake.calls()).toEqual([]);
  rmSync(join(planted, ".."), { recursive: true, force: true });
});

test("Docker not running → the stopped screen continues by itself within 5 s of the daemon coming up", async () => {
  await setup({});
  fake.daemon("down");
  const s = await launch("stopped");
  const page = await s.waitScreen("screen-docker-stopped");
  await expect(page.locator("#screen-docker-stopped-title")).toHaveText("Docker isn't running");
  await expect(page.locator("#screen-docker-stopped-open-docker-desktop")).toBeVisible();
  await everyElementHasUniqueId(page);
  await page.waitForTimeout(1000);
  fake.daemon("up");
  const at = Date.now();
  await expect.poll(() => s.status()?.screen, { timeout: 20_000 }).not.toBe("screen-docker-stopped");
  expect(Date.now() - at).toBeLessThan(5_000);
  await expect.poll(() => s.status()?.screen, { timeout: 30_000 }).toBe("app");
});

test("Compose 2.23.0 → screen-compose-old", async () => {
  await setup({ composeVersion: "2.23.0" });
  const s = await launch("compose-old");
  const page = await s.waitScreen("screen-compose-old");
  await expect(page.locator("#screen-compose-old-found")).toContainText("this Mac has 2.23.0");
  await everyElementHasUniqueId(page);
  expect(composeCalls()).toEqual([]);
});

test("a Docker engine with 2 GiB shows the memory warning on the progress screen", async () => {
  await setup({ memTotal: 2 * 1024 ** 3, pull: { layers: 3, msPerLayer: 600 } });
  const s = await launch("memory");
  const page = await s.waitScreen("screen-progress");
  await expect(page.locator("#screen-progress-memory")).toContainText("Open Agent works best with 4 GB or more");
  await expect(page.locator("#screen-progress-docker-detail")).toHaveText("Docker Desktop is running");
});

for (const endpoint of ["tcp", "foreignSocket"] as const) {
  test(`endpoint ${endpoint} → screen-docker-remote with zero compose calls`, async () => {
    await setup({ endpoint });
    const s = await launch(`remote-${endpoint}`);
    const page = await s.waitScreen("screen-docker-remote");
    await expect(page.locator("#screen-docker-remote-endpoint-endpoint-value")).toHaveText(
      endpoint === "tcp" ? "tcp://192.168.64.2:2376" : "unix:///var/run/mDNSResponder",
    );
    await expect(page.locator("#screen-docker-remote-endpoint-reason-value")).toHaveText(endpoint === "tcp" ? "not_unix" : "foreign_owner");
    await everyElementHasUniqueId(page);
    await page.waitForTimeout(500);
    expect(fake.calls().filter((c) => c.argv[0] === "compose")).toEqual([]);
    expect(fake.calls().map((c) => c.argv.slice(0, 2).join(" "))).toEqual(["context inspect"]);
  });
}

test("no space left during pull → screen-disk-full with the Docker Desktop line", async () => {
  await setup({ noSpace: "pull" });
  const s = await launch("disk-full");
  const page = await s.waitScreen("screen-disk-full");
  await expect(page.locator("#screen-disk-full-title")).toHaveText("Docker's disk is full");
  await expect(page.locator("#screen-disk-full-line")).toContainText("Disk usage limit");
  await expect(page.locator("#screen-disk-full-prune")).toContainText("docker image prune");
  await everyElementHasUniqueId(page);
  expect(fake.calls().some((c) => subOf(c) === "up")).toBe(false);
});

test("outside Applications → the move screen first; Move is logged; Keep it here is remembered", async () => {
  await setup({}, { extra: { OPEN_AGENT_SHELL_FAKE_LOCATION: "outside" } });
  const s = await launch("move-1");
  const page = await s.waitScreen("screen-move-to-applications");
  await everyElementHasUniqueId(page);
  expect(fake.calls()).toEqual([]);
  await page.click("#screen-move-to-applications-move");
  await expect.poll(() => s.log()).toContain("[app] moveToApplicationsFolder (test mode: not moved)");
  await page.click("#screen-move-to-applications-keep");
  await expect.poll(() => s.status()?.screen, { timeout: 30_000 }).toBe("app");
  expect(JSON.parse(readFileSync(join(env.stateDir, "settings.json"), "utf8")).keepOutsideApplications).toBe(true);
  await s.app.close();
  const s2 = await launch("move-2");
  await expect.poll(() => s2.status()?.screen, { timeout: 30_000 }).toBe("app");
  expect(s2.log().split("[app] start").at(-1)).not.toContain("moveToApplications");
});

test("a build without pinned images (the committed dev lock) → screen-no-pins and docker never runs", async () => {
  await setup({}, { services: false });
  const s = await launch("no-pins");
  const page = await s.waitScreen("screen-no-pins");
  await expect(page.locator("#screen-no-pins-how")).toHaveText("This build has no pinned service images; download a release build.");
  await everyElementHasUniqueId(page);
  expect(fake.calls()).toEqual([]);
});

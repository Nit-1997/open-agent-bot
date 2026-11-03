import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { createFakeDocker, type FakeDocker, type FakeScenario, fakeServices, subOf } from "./support/fakeDocker";
import { everyElementHasUniqueId } from "./support/ids";
import { launchShell, newStateDir, type Shell, type ShellEnv } from "./support/launch";

const RANGE = "18430-18431";
const PROJECT = "oab-e2e-desktop-services";
const WORDING = "Saved model keys are not included. Chats, reports and your profile are.";
const fp = (t: string) => createHash("sha256").update(t).digest("hex").slice(0, 12);
const hasUnzip = spawnSync("unzip", ["-v"]).status === 0;

let env: ShellEnv;
let fake: FakeDocker;
let shell: Shell | undefined;

const setup = async (scenario: FakeScenario = {}, video = "services") => {
  const stateDir = newStateDir("services");
  fake = await createFakeDocker("services", {
    pull: { layers: 1, msPerLayer: 10 },
    versions: { agent: "0.0.0-m43a", search: "0.0.0-m43s" },
    ...scenario,
  });
  env = {
    stateDir,
    project: PROJECT,
    portRange: RANGE,
    docker: fake.bin,
    services: fakeServices(stateDir),
    externalLog: join(stateDir, "external.log"),
    savePath: join(stateDir, "saved.out"),
  };
  shell = await launchShell(env, test.info(), { video });
  return shell;
};

const ready = async (s: Shell): Promise<Page> => {
  await expect.poll(() => s.status()?.screen, { timeout: 30_000 }).toBe("app");
  const page = await s.appPage();
  await expect(page.locator("#fa-heading")).toBeVisible();
  return page;
};

const openServices = async (s: Shell): Promise<Page> => {
  const app = await ready(s);
  await app.locator("#fa-open-services").click();
  const page = await s.waitScreen("screen-services");
  await expect(page.locator("#screen-services-services-agent-state")).toHaveText("running · healthy");
  return page;
};

const settings = () =>
  JSON.parse(readFileSync(join(env.stateDir, "settings.json"), "utf8")) as { stopOnQuit: boolean; partials?: string[] };

test.afterEach(async () => {
  if (test.info().status !== test.info().expectedStatus) process.stdout.write(`--- shell.log\n${shell?.log() ?? ""}\n`);
  await shell?.app.close().catch(() => {});
  shell = undefined;
  await fake.cleanup();
  rmSync(env.stateDir, { recursive: true, force: true });
});

test("the account menu item opens Services & data: status, versions from labels, engine, data line; Close returns to the app", async () => {
  const s = await setup({}, "open");
  const page = await openServices(s);
  for (const svc of ["agent", "search", "renderer"]) await expect(page.locator(`#screen-services-services-${svc}-state`)).toBeVisible();
  await expect(page.locator("#screen-services-services-agent-version")).toHaveText("0.0.0-m43a");
  await expect(page.locator("#screen-services-services-search-version")).toHaveText("0.0.0-m43s");
  await expect(page.locator("#screen-services-services-renderer-version")).toHaveText("0.0.0-m43a");
  await expect(page.locator("#screen-services-engine-engine-value")).toHaveText("Docker Desktop");
  await expect(page.locator("#screen-services-engine-context-value")).toHaveText("desktop-linux");
  await expect(page.locator("#screen-services-engine-compose-value")).toHaveText("5.1.1");
  await expect(page.locator("#screen-services-data-volume-value")).toHaveText(`${PROJECT}-data`);
  await expect(page.locator("#screen-services-data-size-value")).toHaveText("3 MB");
  await expect(page.locator("#screen-services-data-reports-value")).toHaveText("2");
  await expect(page.locator("#screen-services-telemetry")).toHaveText("Telemetry: none");
  await expect(page.locator("#screen-services-update")).toBeDisabled();
  await expect(page.locator("#screen-services-update")).toHaveText("Up to date (0.0.0-fake)");
  await everyElementHasUniqueId(page);
  const stats = fake.calls().find((c) => c.argv[0] === "run");
  expect(stats?.argv.join(" ")).toMatch(
    /^run --rm -i --network none --read-only .* -v oab-e2e-desktop-services-data:\/data --entrypoint node .* stats$/,
  );
  await page.locator("#screen-services-close").click();
  await expect.poll(() => s.status()?.screen).toBe("app");
  const app = await s.appPage();
  await expect(app.locator("#fa-heading")).toBeVisible();
  expect(await app.evaluate(() => fetch("/api/whoami").then((r) => r.status))).toBe(200);
});

test("Restart services (confirmed) → a new tokenFp, the app reloads and /api/whoami is 200", async () => {
  const s = await setup({}, "restart");
  const page = await openServices(s);
  const before = s.stack()?.launchToken ?? "";
  await page.locator("#screen-services-restart").click();
  await expect(page.locator("#screen-services-restart-confirm-text")).toHaveText("Chats in progress will stop.");
  await everyElementHasUniqueId(page);
  await page.locator("#screen-services-restart-confirm-yes").click();
  await expect.poll(() => s.status()?.screen, { timeout: 30_000 }).toBe("app");
  const after = s.stack()?.launchToken ?? "";
  expect(fp(after)).not.toBe(fp(before));
  const ups = fake.composeCalls().filter((c) => subOf(c) === "up");
  expect(ups.at(-1)?.tokenFp).toBe(fp(after));
  expect(ups.at(-1)?.argv).toContain("--force-recreate");
  const app = await s.appPage();
  await expect.poll(() => app.evaluate(() => fetch("/api/whoami").then((r) => r.status))).toBe(200);
});

test("View logs: the Requests only filter and the service selector; Save logs has both sections and no token", async () => {
  const s = await setup({}, "logs");
  const page = await openServices(s);
  await page.locator("#screen-services-logs").click();
  await s.waitScreen("screen-logs");
  const pre = page.locator("#screen-logs-text-pre");
  await expect(pre).toContainText("agent starting");
  await page.locator("#screen-logs-text-requests").check();
  await expect(pre).toContainText("[http] GET /health 200");
  await expect(pre).not.toContainText("agent starting");
  await page.locator("#screen-logs-text-requests").uncheck();
  await page.locator("#screen-logs-text-service").selectOption("search");
  await expect(pre).toContainText("search starting");
  await expect(pre).not.toContainText("agent starting");
  await everyElementHasUniqueId(page);
  await page.locator("#screen-logs-save").click();
  await expect(page.locator("#screen-logs-notice")).toContainText("Logs saved to");
  const saved = readFileSync(env.savePath, "utf8");
  expect(saved.startsWith("== service logs ==")).toBe(true);
  expect(saved).toContain("== shell.log ==");
  expect(saved).toContain("agent-1  |");
  const token = s.stack()?.launchToken ?? "";
  expect(token).toMatch(/^[0-9a-f]{64}$/);
  expect(saved.includes(token)).toBe(false);
  await page.locator("#screen-logs-back").click();
  await s.waitScreen("screen-services");
});

test("Export → the zip at the save path with the D15 entries only, and the message has the wording", async () => {
  const s = await setup({}, "export");
  const page = await openServices(s);
  await page.locator("#screen-services-export").click();
  await expect(page.locator("#screen-services-notice")).toContainText(WORDING, { timeout: 20_000 });
  await expect(page.locator("#screen-services-notice")).toContainText(env.savePath);
  expect(existsSync(env.savePath)).toBe(true);
  expect(readdirSync(env.stateDir).filter((f) => f.endsWith(".partial"))).toEqual([]);
  if (hasUnzip) {
    const list = spawnSync("unzip", ["-Z1", env.savePath], { encoding: "utf8" }).stdout.trim().split("\n");
    expect(list).toEqual(["export.json", "open-agent.db", "reports/00000000-0000-4000-8000-000000000001/AbCdEfGhIjKl.html"]);
  }
  const runs = fake.calls().filter((c) => c.argv[0] === "run");
  const exp = runs.find((c) => c.argv.at(-1) === "export");
  expect(exp?.argv.join(" ")).toContain("--network none");
  expect(exp?.argv.join(" ")).not.toMatch(/\/keys|renderer/);
  expect(runs.some((c) => c.argv.includes("check"))).toBe(true);
  expect(s.log()).toMatch(/\[docker\] run --rm -i --network none .* -v oab-e2e-desktop-services-data:\/data .* export/);
  expect(settings().partials).toBeUndefined();
  await everyElementHasUniqueId(page);
});

for (const mode of ["evil", "withCredentials"] as const) {
  test(`a ${mode} export → screen-failed export_invalid and no file`, async () => {
    const s = await setup({ export: mode }, `export-${mode}`);
    const page = await openServices(s);
    await page.locator("#screen-services-export").click();
    await s.waitScreen("screen-failed");
    await expect(page.locator("#screen-failed-reason")).toContainText("export_invalid");
    expect(existsSync(env.savePath)).toBe(false);
    expect(existsSync(`${env.savePath}.partial`)).toBe(false);
    await everyElementHasUniqueId(page);
  });
}

test("noSpace export → screen-disk-full (docker) with the Docker Desktop line", async () => {
  const s = await setup({ noSpace: "export" }, "export-nospace");
  const page = await openServices(s);
  await page.locator("#screen-services-export").click();
  await s.waitScreen("screen-disk-full");
  await expect(page.locator("#screen-disk-full-line")).toContainText("Disk usage limit");
  expect(existsSync(env.savePath)).toBe(false);
});

test("db_corrupt has no Export and shows the deferral text; db_newer exports a snapshot", async () => {
  let s = await setup({ agent: "refuse:db_corrupt", upFailMs: 500 }, "refusal-db_corrupt");
  let page = await s.waitScreen("screen-refusal-db_corrupt");
  await expect(page.locator("#screen-refusal-db_corrupt-export")).toHaveCount(0);
  await expect(page.locator("#screen-refusal-db_corrupt-no-export")).toContainText("Export isn't available for a damaged database");
  await shell?.app.close();
  await fake.cleanup();
  rmSync(env.stateDir, { recursive: true, force: true });
  s = await setup({ agent: "refuse:db_newer", upFailMs: 500 }, "refusal-db_newer");
  page = await s.waitScreen("screen-refusal-db_newer");
  await page.locator("#screen-refusal-db_newer-export").click();
  await expect(page.locator("#screen-refusal-db_newer-notice")).toContainText(WORDING, { timeout: 20_000 });
  expect(existsSync(env.savePath)).toBe(true);
  await everyElementHasUniqueId(page);
});

test("Delete all data → typed confirm → down -v, volume rm with the exact names, then a fresh start", async () => {
  const s = await setup({}, "delete");
  const page = await openServices(s);
  await page.locator("#screen-services-delete").click();
  await s.waitScreen("screen-confirm-delete");
  await expect(page.locator("#screen-confirm-delete-export")).toBeVisible();
  await expect(page.locator("#screen-confirm-delete-confirm")).toBeDisabled();
  await page.locator("#screen-confirm-delete-type-input").fill("delet");
  await expect(page.locator("#screen-confirm-delete-confirm")).toBeDisabled();
  await page.locator("#screen-confirm-delete-type-input").fill("delete");
  await everyElementHasUniqueId(page);
  const mark = fake.calls().length;
  await page.locator("#screen-confirm-delete-confirm").click();
  await expect.poll(() => s.status()?.screen, { timeout: 30_000 }).toBe("app");
  const after = fake.calls().slice(mark);
  const order = after
    .filter((c) => ["down", "volume", "up"].includes(subOf(c) ?? ""))
    .map((c) => (c.argv[0] === "volume" ? c.argv.join(" ") : `compose ${c.argv.slice(11).join(" ")}`));
  expect(order[0]).toBe("compose down -v --remove-orphans");
  expect(order[1]).toBe(`volume rm ${PROJECT}-data ${PROJECT}-keys`);
  expect(order[2]).toMatch(/^compose up -d --no-build --pull never/);
  expect(fake.state().removedVolumes).toEqual(expect.arrayContaining([`${PROJECT}-data`, `${PROJECT}-keys`]));
  expect(JSON.parse(readFileSync(join(env.stateDir, "settings.json"), "utf8")).pendingDelete).toBeUndefined();
});

test("the stop-on-quit toggle persists to settings.json and is honoured on quit", async () => {
  const s = await setup({}, "stop-on-quit");
  const page = await openServices(s);
  const box = page.locator("#screen-services-stop-on-quit-input");
  await expect(box).toBeChecked();
  await box.uncheck();
  await expect.poll(() => settings().stopOnQuit).toBe(false);
  await expect(box).not.toBeChecked();
  await everyElementHasUniqueId(page);
  const mark = fake.calls().length;
  await s.app.close();
  shell = undefined;
  expect(
    fake
      .calls()
      .slice(mark)
      .filter((c) => subOf(c) === "stop"),
  ).toEqual([]);
});

test("the port change (confirmed) recreates the stack and the app loads on the new origin with the cookie", async () => {
  const s = await setup({}, "port");
  const page = await openServices(s);
  await page.locator("#screen-services-port-input").fill("80");
  await page.locator("#screen-services-port-save").click();
  await expect(page.locator("#screen-services-port-error")).toContainText("1024");
  await page.locator("#screen-services-port-input").fill("18433");
  await page.locator("#screen-services-port-save").click();
  await expect(page.locator("#screen-services-port-confirm-text")).toContainText("Services restart on the new port");
  await everyElementHasUniqueId(page);
  await page.locator("#screen-services-port-confirm-yes").click();
  await expect.poll(() => s.status()?.port, { timeout: 30_000 }).toBe(18433);
  await expect.poll(() => s.status()?.screen, { timeout: 30_000 }).toBe("app");
  const app = await s.appPage();
  await expect.poll(() => app.url()).toBe("http://127.0.0.1:18433/");
  expect(await app.evaluate(() => fetch("/api/whoami").then((r) => r.status))).toBe(200);
  expect(s.stack()?.port).toBe(18433);
});

test("quit during a slow export leaves no .partial", async () => {
  const s = await setup({ slow: { exportMs: 20_000 } }, "export-quit");
  const page = await openServices(s);
  await page.locator("#screen-services-export").click();
  await expect.poll(() => existsSync(`${env.savePath}.partial`), { timeout: 10_000 }).toBe(true);
  await s.app.close();
  shell = undefined;
  expect(existsSync(`${env.savePath}.partial`)).toBe(false);
  expect(existsSync(env.savePath)).toBe(false);
});

import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { connectStub, lastReplyLength, send, status } from "../support/localStack";
import { REPORT_MARKER, STUB_MODEL, type StubModel, startStubModel } from "../support/stubModel";
import { everyElementHasUniqueId } from "./support/ids";
import { launchShell, newStateDir, type Shell, type ShellEnv } from "./support/launch";

const PROJECT = process.env.DESKTOP_REAL_PROJECT ?? "oab-factory-m4-3-real";
const SERVICES = process.env.DESKTOP_REAL_SERVICES ?? "";
const RANGE = process.env.DESKTOP_REAL_RANGE ?? "18460-18462";
const STUB_PORT = Number(process.env.STUB_PORT ?? 18463);
const AGENT_IMAGE = process.env.DESKTOP_REAL_AGENT_IMAGE ?? "oab-m4-3-agent:dev";
const DOCKER = "/usr/local/bin/docker";
const DATA = `${PROJECT}-data`;
const KEYS = `${PROJECT}-keys`;
const WORDING = "Saved model keys are not included. Chats, reports and your profile are.";

test.skip(process.env.DESKTOP_REAL_DOCKER !== "1", "real Docker only with DESKTOP_REAL_DOCKER=1");
test.skip(!/^oab-[a-z0-9-]+$/.test(PROJECT), "the real project must be oab-*");

const dockerEnv = { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: process.env.HOME ?? "" };
const docker = (args: string[]) => execFileSync(DOCKER, args, { encoding: "utf8", env: dockerEnv });
const volumes = () =>
  docker(["volume", "ls", "--format", "{{.Name}}"])
    .split("\n")
    .filter((v) => v === DATA || v === KEYS)
    .sort();
const liveCredentials = () =>
  JSON.parse(
    docker([
      "run",
      "--rm",
      "--network",
      "none",
      "--read-only",
      "--user",
      "1001:1001",
      "-v",
      `${DATA}:/data`,
      "--entrypoint",
      "node",
      AGENT_IMAGE,
      "dist/local/dataTools.js",
      "check",
      "/data/open-agent.db",
    ]).trim(),
  ) as { credentials: number; schema: number };

let env: ShellEnv;
let shell: Shell | undefined;
let stub: StubModel | undefined;
const evidence = join(process.cwd(), "..", ".factory/m4/4.3/real");
const say = (m: string) => process.stdout.write(`[real-4.3] ${m}\n`);

test.beforeAll(async () => {
  if (!existsSync(SERVICES)) throw new Error("DESKTOP_REAL_SERVICES must point at a dev services file");
  mkdirSync(evidence, { recursive: true });
  const stateDir = newStateDir("real-43");
  env = {
    stateDir,
    project: PROJECT,
    portRange: RANGE,
    docker: DOCKER,
    services: SERVICES,
    externalLog: join(stateDir, "external.log"),
    savePath: join(stateDir, "saved.out"),
  };
  stub = await startStubModel({ port: STUB_PORT });
});

test.afterAll(async () => {
  await shell?.app.close().catch(() => {});
  await stub?.close();
  for (const [from, to] of [
    ["logs/shell.log", "shell.log"],
    ["status.json", "status.json"],
  ]) {
    const p = join(env.stateDir, from);
    if (existsSync(p)) copyFileSync(p, join(evidence, to));
  }
  spawnSync(
    DOCKER,
    [
      "compose",
      "-p",
      PROJECT,
      "-f",
      join(env.stateDir, "stack/docker-compose.yml"),
      "--project-directory",
      join(env.stateDir, "stack"),
      "--env-file",
      "/dev/null",
      "down",
      "-v",
      "--remove-orphans",
    ],
    { env: { ...dockerEnv, OPEN_AGENT_DATA_VOLUME: DATA, OPEN_AGENT_KEYS_VOLUME: KEYS, OPEN_AGENT_PORT: "18460" }, stdio: "ignore" },
  );
  spawnSync(DOCKER, ["volume", "rm", DATA, KEYS], { env: dockerEnv, stdio: "ignore" });
  rmSync(env.stateDir, { recursive: true, force: true });
});

const ready = async (s: Shell, timeout = 300_000): Promise<Page> => {
  await expect.poll(() => s.status()?.screen, { timeout, intervals: [500] }).toBe("app");
  return s.appPage();
};

async function onboard(page: Page, baseUrl: string): Promise<void> {
  const step = page.locator("#onboarding-step");
  await expect(step).toBeVisible({ timeout: 60_000 });
  for (let i = 0; i < 10; i++) {
    if (await page.locator("#onboarding-model-providers").isVisible()) {
      await connectStub(page, baseUrl);
      await expect(page.locator("#onboarding-model-list")).toBeVisible();
    }
    if (await page.locator("#onboarding-model-list").isVisible()) await page.getByRole("radio", { name: new RegExp(STUB_MODEL) }).click();
    if (await page.locator("#agent-section-onboarding-name-input").isVisible()) {
      await page.locator("#agent-section-onboarding-name-input").fill("Sage");
      await page.locator("#agent-section-onboarding-look-ember").click();
      await page.locator("#agent-section-onboarding-tone-brief").click();
    }
    if (await page.locator("#onboarding-summary").isVisible()) break;
    await page.locator("#onboarding-next").click();
  }
  await page.locator("#onboarding-next").click();
  await expect(page.locator("#rail")).toBeVisible();
}

const api = <T>(page: Page, path: string) => page.evaluate((p) => fetch(p).then((r) => r.json()), path) as Promise<T>;

test("real Docker: a chat and a report, Services & data from the account menu, logs, Save logs, export without keys, delete all data", async () => {
  test.setTimeout(1_200_000);
  const word = `harbour${Date.now().toString(36)}`;
  const title = `Field notes ${word}`;

  shell = await launchShell(env, test.info(), { video: "services-real" });
  const s = shell;
  let page = await ready(s);
  say(`app on ${page.url()}`);
  await onboard(page, `http://host.docker.internal:${STUB_PORT}/v1`);

  await send(page, `Tell me about lighthouses ${word}`);
  await expect(status(page)).toBeHidden({ timeout: 120_000 });
  await expect.poll(() => lastReplyLength(page), { timeout: 60_000 }).toBeGreaterThan(0);
  await send(page, `${title} ${REPORT_MARKER}`);
  await expect(status(page)).toBeHidden({ timeout: 120_000 });
  await expect
    .poll(async () => (await api<{ items: { title: string }[] }>(page, "/api/reports")).items.map((r) => r.title), { timeout: 60_000 })
    .toContain(title);
  const chats = await api<{ items: { title: string }[] }>(page, "/api/chats");
  say(`chats: ${chats.items.map((c) => c.title).join(" | ")}`);
  const health = await api<{ schema: number; version: string }>(page, "/health");
  const live = liveCredentials();
  say(`live db: credentials=${live.credentials} schema=${live.schema}; /health schema=${health.schema} version=${health.version}`);
  expect(live.credentials).toBe(1);

  await page.locator("#account-menu-button").click();
  await expect(page.locator("#account-menu-services")).toHaveText("Services & data");
  await page.locator("#account-menu-services").click();
  const sp = await s.waitScreen("screen-services", 30_000);
  await expect(sp.locator("#screen-services-services-agent-state")).toHaveText("running · healthy", { timeout: 30_000 });
  await expect(sp.locator("#screen-services-services-agent-version")).toHaveText(health.version);
  await expect(sp.locator("#screen-services-services-renderer-version")).toHaveText(health.version);
  await expect(sp.locator("#screen-services-engine-engine-value")).toHaveText("Docker Desktop");
  await expect(sp.locator("#screen-services-engine-cli-value")).toHaveText(DOCKER);
  await expect(sp.locator("#screen-services-data-volume-value")).toHaveText(DATA, { timeout: 60_000 });
  await expect(sp.locator("#screen-services-data-reports-value")).toHaveText("1");
  say(`services: ${(await sp.locator("#screen-services-services").innerText()).replace(/\s+/g, " ")}`);
  say(`engine: ${(await sp.locator("#screen-services-engine").innerText()).replace(/\s+/g, " ")}`);
  say(`data: ${(await sp.locator("#screen-services-data").innerText()).replace(/\s+/g, " ")}`);
  await everyElementHasUniqueId(sp);

  await sp.locator("#screen-services-logs").click();
  await s.waitScreen("screen-logs");
  await sp.locator("#screen-logs-text-requests").check();
  await expect(sp.locator("#screen-logs-text-pre")).toContainText("[http]");
  await sp.locator("#screen-logs-save").click();
  await expect(sp.locator("#screen-logs-notice")).toContainText("Logs saved to");
  const saved = readFileSync(env.savePath, "utf8");
  const token = s.stack()?.launchToken ?? "";
  expect(token).toMatch(/^[0-9a-f]{64}$/);
  expect(saved.startsWith("== service logs ==")).toBe(true);
  expect(saved).toContain("== shell.log ==");
  expect(saved.includes(token)).toBe(false);
  renameSync(env.savePath, join(evidence, "saved-logs.txt"));
  writeFileSync(join(evidence, "token-fp-check.txt"), `saved logs contain the current token: ${saved.includes(token)}\n`);
  await sp.locator("#screen-logs-back").click();
  await s.waitScreen("screen-services");

  await sp.locator("#screen-services-export").click();
  await expect(sp.locator("#screen-services-notice")).toContainText(WORDING, { timeout: 180_000 });
  say(`export notice: ${await sp.locator("#screen-services-notice").innerText()}`);
  const zip = join(evidence, "export.zip");
  renameSync(env.savePath, zip);
  const names = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).trim().split("\n");
  say(`zip entries: ${names.join(", ")}`);
  expect(names).toContain("export.json");
  expect(names).toContain("open-agent.db");
  expect(names.some((n) => n.startsWith("reports/") && n.endsWith(".html"))).toBe(true);
  expect(names.filter((n) => /(^|\/)(keys?|kek)(\.|\/|$)/i.test(n))).toEqual([]);
  const db = join(evidence, "export-open-agent.db");
  writeFileSync(db, execFileSync("unzip", ["-p", zip, "open-agent.db"]));
  const q = (sql: string) => execFileSync("sqlite3", [db, sql], { encoding: "utf8" }).trim();
  expect(q("SELECT count(*) FROM provider_credentials;")).toBe("0");
  expect(Number(q("PRAGMA user_version;"))).toBe(health.schema);
  expect(q("SELECT group_concat(title, ' | ') FROM chats;")).toContain(word);
  expect(liveCredentials().credentials).toBe(1);
  const zipBytes = readFileSync(zip);
  expect(zipBytes.includes(Buffer.from(token))).toBe(false);
  const exportLine =
    s
      .log()
      .split("\n")
      .find((l) => /\[docker\] run --rm -i --network none .* export /.test(l)) ?? "";
  say(`export argv: ${exportLine.replace(/^.*\[docker\] /, "")}`);
  expect(exportLine).toContain(`-v ${DATA}:/data`);
  expect(exportLine).not.toContain("/keys");

  await sp.locator("#screen-services-delete").click();
  await s.waitScreen("screen-confirm-delete");
  await sp.locator("#screen-confirm-delete-type-input").fill("delete");
  await everyElementHasUniqueId(sp);
  await sp.locator("#screen-confirm-delete-confirm").click();
  await expect.poll(() => s.status()?.screen, { timeout: 300_000, intervals: [500] }).toBe("app");
  page = await s.appPage();
  await expect(page.locator("#onboarding-step")).toBeVisible({ timeout: 60_000 });
  const after = await api<{ items: unknown[] }>(page, "/api/chats");
  expect(after.items).toEqual([]);
  const log = s.log();
  const downAt = log.search(/\[docker\] compose .* down -v --remove-orphans/);
  const rmAt = log.search(new RegExp(`\\[docker\\] volume rm ${DATA} ${KEYS}`));
  expect(downAt).toBeGreaterThan(0);
  expect(rmAt).toBeGreaterThan(downAt);
  say(`after delete: chats=${after.items.length}, volumes now ${volumes().join(",")} (recreated empty by the fresh start)`);
  expect(liveCredentials().credentials).toBe(0);
});

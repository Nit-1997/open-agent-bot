import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { createFakeDocker, FAKE_DIR, type FakeDocker, type FakeScenario, fakeServices, subOf } from "./support/fakeDocker";
import { everyElementHasUniqueId } from "./support/ids";
import { launchShell, newStateDir, type Shell, type ShellEnv } from "./support/launch";

const RANGE = "18424-18424";
const PROJECT = "oab-e2e-desktop-refusals";
const REFUSAL_MESSAGES = JSON.parse(readFileSync(join(FAKE_DIR, "refusal-messages.json"), "utf8")) as Record<string, string>;
const CODES = [
  "config",
  "db_corrupt",
  "db_newer",
  "db_migration",
  "kek_missing",
  "keyfile_invalid",
  "ui_missing",
  "identity",
  "listen",
] as const;

let env: ShellEnv;
let fake: FakeDocker;
let shell: Shell | undefined;

const setup = async (scenario: FakeScenario) => {
  const stateDir = newStateDir("refusals");
  fake = await createFakeDocker("refusals", { pull: { layers: 1, msPerLayer: 10 }, upFailMs: 8000, ...scenario });
  env = {
    stateDir,
    project: PROJECT,
    portRange: RANGE,
    docker: fake.bin,
    services: fakeServices(stateDir),
    externalLog: join(stateDir, "external.log"),
    savePath: join(stateDir, "saved.bin"),
  };
  shell = await launchShell(env, test.info(), { video: String(scenario.agent).replace(/[^a-z0-9]+/gi, "-") });
  return shell;
};

test.afterEach(async () => {
  if (test.info().status !== test.info().expectedStatus) process.stdout.write(`--- shell.log\n${shell?.log() ?? ""}\n`);
  await shell?.app.close().catch(() => {});
  shell = undefined;
  await fake.cleanup();
  rmSync(env.stateDir, { recursive: true, force: true });
});

for (const code of CODES) {
  test(`refusal ${code} → screen-refusal-${code} with the exact line, and compose stop agent right after`, async () => {
    const s = await setup({ agent: `refuse:${code}` });
    const page = await s.waitScreen(`screen-refusal-${code}`);
    await expect(page.locator(`#screen-refusal-${code}-line`)).toHaveText(`[startup] refused code=${code} ${REFUSAL_MESSAGES[code]}`);
    await everyElementHasUniqueId(page);
    const calls = fake.calls();
    const up = calls.findIndex((c) => subOf(c) === "up");
    const stop = calls.findIndex((c) => subOf(c) === "stop");
    expect(up).toBeGreaterThanOrEqual(0);
    expect(calls[stop]?.argv.slice(11)).toEqual(["stop", "agent"]);
    expect(calls[up]?.signal ?? "").toBe("SIGTERM");
    if (code === "kek_missing")
      await expect(page.locator("#screen-refusal-kek_missing-count")).toHaveText(
        "1 saved model key can't be unlocked because the key file is gone.",
      );
    if (code === "db_corrupt")
      await expect(page.locator("#screen-refusal-db_corrupt-no-export")).toContainText("Export isn't available for a damaged database");
    if (code === "listen") await expect(page.locator("#screen-refusal-listen-pick-port")).toBeVisible();
    expect(await s.app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length)).toBe(1);
  });
}

test("kek_missing → Reset requires typing reset → exactly one up with RESET=1 → the app; the next up passes it empty", async () => {
  const s = await setup({ agent: "refuse:kek_missing", resetHeals: true });
  const page = await s.waitScreen("screen-refusal-kek_missing");
  expect(await s.app.evaluate(() => 1)).toBe(1);
  const forged = await page.evaluate(() =>
    (window as unknown as { shell: { act(a: unknown): Promise<unknown> } }).shell.act({ type: "resetCredentials", confirm: "reset" }),
  );
  expect(forged).toEqual({ ok: false, error: "not_confirming" });
  await page.click("#screen-refusal-kek_missing-reset");
  const confirm = await s.waitScreen("screen-confirm-reset");
  await expect(confirm.locator("#screen-confirm-reset-what")).toHaveText(
    "This deletes 1 saved model key. Chats, reports and your profile stay. You'll add your keys again in Models.",
  );
  await everyElementHasUniqueId(confirm);
  await expect(confirm.locator("#screen-confirm-reset-confirm")).toBeDisabled();
  await confirm.fill("#screen-confirm-reset-type-input", "rese");
  await expect(confirm.locator("#screen-confirm-reset-confirm")).toBeDisabled();
  await confirm.fill("#screen-confirm-reset-type-input", "reset");
  await expect(confirm.locator("#screen-confirm-reset-confirm")).toBeEnabled();
  await confirm.click("#screen-confirm-reset-confirm");
  await expect.poll(() => s.status()?.screen, { timeout: 30_000 }).toBe("app");
  const ups = fake.calls().filter((c) => subOf(c) === "up");
  expect(ups.map((u) => u.reset)).toEqual([false, true]);
  expect(ups[1]?.tokenFp).not.toBe(ups[0]?.tokenFp);
  await (await s.shellPage()).evaluate(() =>
    (window as unknown as { shell: { act(a: unknown): Promise<unknown> } }).shell.act({ type: "restartServices" }),
  );
  await expect.poll(() => fake.calls().filter((c) => subOf(c) === "up").length, { timeout: 30_000 }).toBe(3);
  expect(
    fake
      .calls()
      .filter((c) => subOf(c) === "up")
      .map((u) => u.reset),
  ).toEqual([false, true, false]);
});

test("an exit code that disagrees with the line → screen-failed refusal_mismatch showing both", async () => {
  const s = await setup({ agent: "refuse:kek_missing", refuseExit: 78 });
  const page = await s.waitScreen("screen-failed");
  await expect(page.locator("#screen-failed-title")).toHaveText("The agent stopped with an unexpected refusal");
  await expect(page.locator("#screen-failed-detail")).toContainText("exit code 78; line [startup] refused code=kek_missing");
  await everyElementHasUniqueId(page);
  expect(fake.calls().some((c) => subOf(c) === "stop" && c.argv.at(-1) === "agent")).toBe(true);
});

test("an unknown crash → screen-failed crashed with the exit code and a redacted log tail", async () => {
  const s = await setup({ agent: "crash:3" });
  const page = await s.waitScreen("screen-failed");
  await expect(page.locator("#screen-failed-reason")).toHaveText("Reason: crashed, exit code 3");
  await expect(page.locator("#screen-failed-tail")).toContainText("OPEN_AGENT_LAUNCH_TOKEN=[token]");
  const token = s.stack()?.launchToken ?? "missing";
  expect(await page.locator("body").innerText()).not.toContain(token);
  expect(s.log()).not.toContain(token);
  await everyElementHasUniqueId(page);
});

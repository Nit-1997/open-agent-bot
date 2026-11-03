import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { everyElementHasUniqueId } from "./support/ids";
import { launchShell, newStateDir, type Shell, type ShellEnv } from "./support/launch";

const PROJECT = process.env.DESKTOP_REAL_PROJECT ?? "oab-factory-m4-2-real";
const SERVICES = process.env.DESKTOP_REAL_SERVICES ?? "";
const RANGE = process.env.DESKTOP_REAL_RANGE ?? "18450-18454";
const DOCKER = "/usr/local/bin/docker";
const DATA = `${PROJECT}-data`;
const KEYS = `${PROJECT}-keys`;
const fp = (t: string) => createHash("sha256").update(t).digest("hex").slice(0, 12);

test.skip(process.env.DESKTOP_REAL_DOCKER !== "1", "real Docker only with DESKTOP_REAL_DOCKER=1");
test.skip(!/^oab-[a-z0-9-]+$/.test(PROJECT), "the real project must be oab-*");

const docker = (args: string[]) =>
  execFileSync(DOCKER, args, { encoding: "utf8", env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: process.env.HOME ?? "" } });
const containerOf = (service: string) => `${PROJECT}-${service}-1`;
const inspect = (service: string, format: string) => docker(["inspect", "-f", format, containerOf(service)]).trim();
const states = () =>
  docker([
    "ps",
    "-a",
    "--filter",
    `label=com.docker.compose.project=${PROJECT}`,
    "--format",
    '{{.Label "com.docker.compose.service"}}={{.State}}',
  ])
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
const agentToken = () =>
  (JSON.parse(inspect("agent", "{{json .Config.Env}}")) as string[]).find((e) => e.startsWith("OPEN_AGENT_LAUNCH_TOKEN="))?.slice(24) ?? "";
const agentEnv = (name: string) =>
  (JSON.parse(inspect("agent", "{{json .Config.Env}}")) as string[]).find((e) => e.startsWith(`${name}=`))?.slice(name.length + 1);

let env: ShellEnv;
let shell: Shell | undefined;
const evidence = join(process.cwd(), "..", ".factory/m4/4.2/real");

test.beforeAll(() => {
  if (!existsSync(SERVICES)) throw new Error("DESKTOP_REAL_SERVICES must point at a dev services file");
  mkdirSync(evidence, { recursive: true });
  const stateDir = newStateDir("real");
  env = {
    stateDir,
    project: PROJECT,
    portRange: RANGE,
    docker: DOCKER,
    services: SERVICES,
    externalLog: join(stateDir, "external.log"),
    savePath: join(stateDir, "saved.bin"),
  };
});

test.afterAll(() => {
  const log = join(env.stateDir, "logs/shell.log");
  if (existsSync(log)) execFileSync("cp", [log, join(evidence, "shell.log")]);
  const calls = existsSync(join(env.stateDir, "status.json")) ? readFileSync(join(env.stateDir, "status.json"), "utf8") : "";
  if (calls) execFileSync("cp", [join(env.stateDir, "status.json"), join(evidence, "status.json")]);
  try {
    execFileSync(
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
      {
        env: {
          PATH: "/usr/local/bin:/usr/bin:/bin",
          HOME: process.env.HOME ?? "",
          OPEN_AGENT_DATA_VOLUME: DATA,
          OPEN_AGENT_KEYS_VOLUME: KEYS,
          OPEN_AGENT_PORT: "18450",
        },
        stdio: "ignore",
      },
    );
  } catch {}
  try {
    docker(["volume", "rm", DATA, KEYS]);
  } catch {}
  rmSync(env.stateDir, { recursive: true, force: true });
});

const launch = async (video: string) => {
  shell = await launchShell(env, test.info(), { video });
  return shell;
};
const close = async () => {
  await shell?.app.close();
  shell = undefined;
};
const ready = async (s: Shell, timeout = 300_000): Promise<Page> => {
  await expect.poll(() => s.status()?.screen, { timeout, intervals: [500] }).toBe("app");
  const page = await s.appPage();
  await expect(page.locator("#onboarding-step")).toBeVisible({ timeout: 60_000 });
  return page;
};
const say = (m: string) => process.stdout.write(`[real] ${m}\n`);

test("real Docker: pull with progress, health, the local UI, stop-on-quit, token reuse, kek_missing reset, watchdog trip and recovery", async () => {
  test.setTimeout(1_200_000);

  const s1 = await launch("1-fresh");
  const shellPage = await s1.shellPage();
  const seen = new Set<string>();
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline && s1.status()?.screen !== "app") {
    const t = await shellPage
      .locator("#screen-progress-download-detail")
      .textContent({ timeout: 500 })
      .catch(() => null);
    if (t && /layer \d+ of \d+/.test(t)) seen.add(t);
    if (s1.status()?.screen?.startsWith("screen-") && s1.status()?.screen !== "screen-progress") break;
    await shellPage.waitForTimeout(250);
  }
  say(`progress values seen: ${[...seen].length}: ${[...seen].slice(0, 6).join(" | ")}`);
  expect(seen.size).toBeGreaterThanOrEqual(3);
  await expect(shellPage.locator("#screen-progress-docker-detail")).toHaveText("Docker Desktop is running");
  const page = await ready(s1);
  await everyElementHasUniqueId(shellPage);
  const port = s1.stack()?.port ?? 0;
  expect(port).toBe(18450);
  const t1 = s1.stack()?.launchToken ?? "";
  expect(t1).toMatch(/^[0-9a-f]{64}$/);
  expect(fp(agentToken())).toBe(fp(t1));
  const log1 = s1.log();
  expect(log1.indexOf(`[stack] port check ok 127.0.0.1:${port}`)).toBeLessThan(log1.indexOf("[app] cookie installed"));
  expect(log1).toContain("[docker] pull 127.0.0.1:18467/oab-m4-2-agent@sha256:");
  expect(await page.evaluate(() => fetch("/api/chats").then((r) => r.status))).toBe(200);
  const bare = await fetch(`http://127.0.0.1:${port}/api/chats`);
  expect(bare.status).toBe(401);
  expect(((await bare.json()) as { error?: string }).error).toBe("launch_required");
  const saved = await page.evaluate(() =>
    fetch("/api/providers/openrouter/key", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "sk-or-v1-oab-factory-not-a-real-key" }),
    }).then(async (r) => `${r.status} ${await r.text()}`),
  );
  say(`saved a dummy key: ${saved}`);
  expect(saved.startsWith("200")).toBe(true);
  const openrouter = (p: Page) =>
    p.evaluate(() =>
      fetch("/api/providers")
        .then((r) => r.json())
        .then((j: { providers: { id: string }[] }) => JSON.stringify(j.providers.find((x) => x.id === "openrouter"))),
    );
  const withKey = await openrouter(page);
  say(`openrouter with the saved key: ${withKey}`);
  const created1 = inspect("agent", "{{.Created}}");
  say(`agent created ${created1}, tokenFp ${fp(t1)}`);

  await close();
  say(`after quit: ${states().join(" ")}`);
  expect(states()).toEqual(["agent=exited", "renderer=exited", "search=exited"]);

  const before2 = (readFileSync(join(env.stateDir, "logs/shell.log"), "utf8").match(/\n/g) ?? []).length;
  const s2 = await launch("2-relaunch");
  await ready(s2);
  const tail2 = s2.log().split("\n").slice(before2).join("\n");
  expect(tail2).toMatch(/\[docker\] compose .* start env=/);
  expect(tail2).not.toMatch(/\[docker\] compose .* up -d/);
  expect(s2.stack()?.launchToken).toBe(t1);
  expect(inspect("agent", "{{.Created}}")).toBe(created1);
  say(`relaunch: compose start only, same tokenFp ${fp(s2.stack()?.launchToken ?? "")}, Created unchanged`);
  await close();
  expect(states()).toEqual(["agent=exited", "renderer=exited", "search=exited"]);

  docker(["run", "--rm", "-v", `${KEYS}:/keys`, "alpine", "rm", "/keys/kek"]);
  say("removed /keys/kek from the test keys volume");
  const s3 = await launch("3-kek-missing");
  const refusal = await s3.waitScreen("screen-refusal-kek_missing", 180_000);
  await expect(refusal.locator("#screen-refusal-kek_missing-count")).toHaveText(
    "1 saved model key can't be unlocked because the key file is gone.",
  );
  await expect(refusal.locator("#screen-refusal-kek_missing-line")).toContainText("[startup] refused code=kek_missing");
  await everyElementHasUniqueId(refusal);
  expect(inspect("agent", "{{.State.Status}}")).toBe("exited");
  await refusal.click("#screen-refusal-kek_missing-reset");
  const confirm = await s3.waitScreen("screen-confirm-reset");
  await confirm.fill("#screen-confirm-reset-type-input", "reset");
  await confirm.click("#screen-confirm-reset-confirm");
  const page3 = await ready(s3);
  expect(agentEnv("OPEN_AGENT_RESET_CREDENTIALS")).toBe("1");
  expect(s3.log().match(/\[stack\] up with OPEN_AGENT_RESET_CREDENTIALS=1/g)).toHaveLength(1);
  const providers = await openrouter(page3);
  expect(providers).not.toBe(withKey);
  const t3 = s3.stack()?.launchToken ?? "";
  expect(fp(t3)).not.toBe(fp(t1));
  say(`reset: one up with RESET=1, new tokenFp ${fp(t3)}; openrouter now ${providers}`);

  docker(["kill", containerOf("agent")]);
  say("killed the agent container");
  await expect
    .poll(
      () =>
        s3.app.evaluate(
          async ({ session }) => (await session.fromPartition("persist:open-agent").cookies.get({ name: "oa_launch" })).length,
        ),
      { timeout: 30_000 },
    )
    .toBe(0);
  const stopped = await s3.waitScreen("screen-services-stopped", 60_000);
  await expect(stopped.locator("#screen-services-stopped-reason")).toContainText("Reason: crashed, exit code 137");
  await everyElementHasUniqueId(stopped);
  await stopped.click("#screen-services-stopped-restart");
  await ready(s3);
  const t4 = s3.stack()?.launchToken ?? "";
  expect(fp(t4)).not.toBe(fp(t3));
  expect(fp(agentToken())).toBe(fp(t4));
  expect(agentEnv("OPEN_AGENT_RESET_CREDENTIALS")).toBe("");
  say(`watchdog: services-stopped → Restart services → up --force-recreate, new tokenFp ${fp(t4)}`);
  await close();
  expect(states()).toEqual(["agent=exited", "renderer=exited", "search=exited"]);

  const all = readFileSync(join(env.stateDir, "logs/shell.log"), "utf8") + readFileSync(join(env.stateDir, "status.json"), "utf8");
  for (const t of [t1, t3, t4]) expect(all).not.toContain(t);
});

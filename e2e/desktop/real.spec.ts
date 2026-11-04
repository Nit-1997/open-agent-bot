import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test, type Video } from "@playwright/test";
import { lastReplyLength, send, status, stubBaseUrl } from "../support/localStack";
import { LONG_MARKER, REPORT_MARKER, type StubModel, startStubModel } from "../support/stubModel";
import { everyElementHasUniqueId } from "./support/ids";
import { launchShell, newStateDir, type Shell, type ShellEnv } from "./support/launch";
import { onboardWithStub } from "./support/onboard";
import {
  containerEnv,
  DOCKER,
  docker,
  ENGINE,
  firstPort,
  fp,
  OAB_NAME,
  projectStates,
  REAL,
  readServices,
  shellExtra,
  tearDown,
} from "./support/real";

const PROJECT = process.env.DESKTOP_REAL_PROJECT ?? "oab-factory-m4-5-real";
const SERVICES = process.env.DESKTOP_REAL_SERVICES ?? "";
const RANGE = process.env.DESKTOP_REAL_RANGE ?? "18480-18482";
const STUB_PORT = Number(process.env.STUB_PORT ?? 18483);
const STUB_BIND = process.env.STUB_BIND;
const EVIDENCE = process.env.DESKTOP_REAL_EVIDENCE ?? join(process.cwd(), "..", ".factory/m4/4.5/real");
const PORT = firstPort(RANGE);
const KEYS = `${PROJECT}-keys`;

test.skip(!REAL, "real Docker only with DESKTOP_REAL_DOCKER=1");
test.skip(!OAB_NAME.test(PROJECT), "the real project must be oab-*");

const containerOf = (service: string) => `${PROJECT}-${service}-1`;
const inspect = (service: string, format: string) => docker(["inspect", "-f", format, containerOf(service)]).trim();
const states = () => projectStates(PROJECT);
const agentEnv = (name: string) =>
  containerEnv(PROJECT, "agent")
    .find((e) => e.startsWith(`${name}=`))
    ?.slice(name.length + 1);
const agentToken = () => agentEnv("OPEN_AGENT_LAUNCH_TOKEN") ?? "";
const say = (m: string) => process.stdout.write(`[real] ${m}\n`);
const logLines = () => (readFileSync(join(env.stateDir, "logs/shell.log"), "utf8").match(/\n/g) ?? []).length;
const logFrom = (from: number) => readFileSync(join(env.stateDir, "logs/shell.log"), "utf8").split("\n").slice(from).join("\n");

let env: ShellEnv;
let shell: Shell | undefined;
let stub: StubModel | undefined;

const freshEnv = (label: string): ShellEnv => {
  const stateDir = newStateDir(label);
  return {
    stateDir,
    project: PROJECT,
    portRange: RANGE,
    docker: DOCKER,
    services: SERVICES,
    externalLog: join(stateDir, "external.log"),
    savePath: join(stateDir, "saved.bin"),
    extra: shellExtra(),
  };
};

const keepEvidence = (label: string) => {
  for (const [from, to] of [
    ["logs/shell.log", `${label}-shell.log`],
    ["status.json", `${label}-status.json`],
  ]) {
    const p = join(env.stateDir, from);
    if (existsSync(p)) copyFileSync(p, join(EVIDENCE, to));
  }
};

test.beforeAll(async () => {
  if (!existsSync(SERVICES)) throw new Error("DESKTOP_REAL_SERVICES must point at a dev services file");
  mkdirSync(EVIDENCE, { recursive: true });
  stub = await startStubModel({ port: STUB_PORT, ...(STUB_BIND ? { bind: STUB_BIND } : {}) });
});

test.afterAll(async () => {
  await stub?.close();
});

test.afterEach(async () => {
  await shell?.app.close().catch(() => {});
  shell = undefined;
  if (env) tearDown({ project: PROJECT, stateDir: env.stateDir, port: PORT });
});

const launch = async (video: string) => {
  shell = await launchShell(env, test.info(), { video });
  return shell;
};
const close = async () => {
  await shell?.app.close();
  shell = undefined;
};
const appReady = async (s: Shell, timeout = 300_000): Promise<Page> => {
  await expect.poll(() => s.status()?.screen, { timeout, intervals: [500] }).toBe("app");
  return s.appPage();
};
const ready = async (s: Shell, timeout = 300_000): Promise<Page> => {
  const page = await appReady(s, timeout);
  await expect(page.locator("#onboarding-step")).toBeVisible({ timeout: 60_000 });
  return page;
};

test("real Docker: pull with progress, health, the local UI, stop-on-quit, token reuse, kek_missing reset, watchdog trip and recovery", async () => {
  test.setTimeout(1_200_000);
  env = freshEnv("real");
  const pins = readServices(SERVICES);
  const pulls = pins.pull !== false;

  const s1 = await launch("1-fresh");
  const shellPage = await s1.shellPage();
  await shellPage.evaluate(() => {
    const w = window as unknown as { progressSeen: string[] };
    w.progressSeen = [];
    const read = () => {
      const t = document.getElementById("screen-progress-download-detail")?.textContent ?? "";
      if (t && w.progressSeen.at(-1) !== t) w.progressSeen.push(t);
    };
    read();
    new MutationObserver(read).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  });
  const progressSeen = () =>
    shellPage.evaluate(() => (window as unknown as { progressSeen?: string[] }).progressSeen ?? []).catch(() => [] as string[]);
  const counted = (all: string[]) => [...new Set(all.filter((t) => /layer \d+ of [1-9]\d*/.test(t) && !/ of 0\b/.test(t)))];
  await expect
    .poll(
      async () => {
        const screen = s1.status()?.screen;
        return screen === "app" || (screen !== undefined && screen !== "screen-progress");
      },
      { timeout: 600_000, intervals: [500] },
    )
    .toBe(true);
  const recorded = await progressSeen();
  const seen = counted(recorded);
  say(`progress values seen: ${seen.length}: ${seen.slice(0, 6).join(" | ")}`);
  expect(recorded.some((t) => / of 0\b/.test(t))).toBe(false);
  if (pulls) expect(seen.length).toBeGreaterThanOrEqual(3);
  await expect(shellPage.locator("#screen-progress-docker-detail")).toHaveText(`${ENGINE} is running`);
  const page = await ready(s1);
  await everyElementHasUniqueId(shellPage);
  const port = s1.stack()?.port ?? 0;
  expect(port).toBe(PORT);
  const t1 = s1.stack()?.launchToken ?? "";
  expect(t1).toMatch(/^[0-9a-f]{64}$/);
  expect(fp(agentToken())).toBe(fp(t1));
  const log1 = s1.log();
  expect(log1.indexOf(`[stack] port check ok 127.0.0.1:${port}`)).toBeLessThan(log1.indexOf("[app] cookie installed"));
  if (pulls) expect(log1).toContain(`[docker] pull ${pins.images.agent}`);
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

  const before2 = logLines();
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
  keepEvidence("lifecycle");
});

test("real smoke: fresh state → healthy → onboarding with the stub → a streamed reply and a report → cookie-less 401 → stop on quit → start only on relaunch", async () => {
  test.setTimeout(900_000);
  env = freshEnv("smoke");
  const word = `beacon${Date.now().toString(36)}`;
  const videos: Video[] = [];

  const s1 = await launch("smoke-1");
  const page = await appReady(s1);
  const v1 = page.video();
  if (v1) videos.push(v1);
  const port = s1.stack()?.port ?? 0;
  expect(port).toBe(PORT);
  const t1 = s1.stack()?.launchToken ?? "";
  expect(t1).toMatch(/^[0-9a-f]{64}$/);
  expect(fp(agentToken())).toBe(fp(t1));
  const log1 = s1.log();
  expect(log1).toContain(`[stack] port check ok 127.0.0.1:${port}`);
  expect(log1.indexOf(`[stack] port check ok 127.0.0.1:${port}`)).toBeLessThan(log1.indexOf("[app] cookie installed"));
  say(`healthy on ${page.url()}, tokenFp ${fp(t1)}`);

  const baseUrl = stubBaseUrl({ STUB_HOST: process.env.STUB_HOST ?? "host.docker.internal", STUB_PORT: String(STUB_PORT) });
  await onboardWithStub(page, baseUrl);
  say(`onboarding done with ${baseUrl}`);

  await send(page, `Tell me about lighthouses ${word} ${LONG_MARKER}`);
  const growth: number[] = [];
  const deadline = Date.now() + 120_000;
  while (growth.length < 3) {
    if (Date.now() > deadline) throw new Error(`the reply did not grow within 120 s (${growth.join(", ")})`);
    const length = await lastReplyLength(page);
    if (length > (growth.at(-1) ?? 0)) growth.push(length);
    await page.waitForTimeout(200);
  }
  say(`reply lengths while streaming: ${growth.join(", ")}`);
  expect(growth[1]).toBeGreaterThan(growth[0] ?? 0);
  await expect(status(page)).toBeHidden({ timeout: 120_000 });
  const final = await lastReplyLength(page);
  expect(final).toBeGreaterThanOrEqual(growth.at(-1) ?? 0);
  say(`reply finished at ${final} characters`);

  const title = `Smoke notes ${word}`;
  await send(page, `${title} ${REPORT_MARKER}`);
  await expect(status(page)).toBeHidden({ timeout: 120_000 });
  const reports = async () =>
    (await page.evaluate(() => fetch("/api/reports").then((r) => r.json()))) as { items: { id: string; title: string }[] };
  await expect.poll(async () => (await reports()).items.map((r) => r.title), { timeout: 60_000 }).toContain(title);
  const report = (await reports()).items.find((r) => r.title === title);
  say(`report ${report?.id} "${report?.title}"`);
  expect(stub?.requests() ?? 0).toBeGreaterThanOrEqual(2);

  const inApp = await page.evaluate(() => fetch("/api/chats").then(async (r) => ({ status: r.status, body: await r.json() })));
  expect(inApp.status).toBe(200);
  expect(JSON.stringify(inApp.body)).toContain(word);
  const bare = await fetch(`http://127.0.0.1:${port}/api/chats`);
  const bareBody = (await bare.json()) as { error?: string };
  say(`cookie-less GET /api/chats from Node → ${bare.status} ${JSON.stringify(bareBody)}`);
  expect(bare.status).toBe(401);
  expect(bareBody.error).toBe("launch_required");
  await everyElementHasUniqueId(await s1.shellPage());
  const created1 = inspect("agent", "{{.Created}}");

  const quitFrom = logLines();
  await close();
  say(`after quit: ${states().join(" ")}`);
  expect(states()).toEqual(["agent=exited", "renderer=exited", "search=exited"]);
  expect(logFrom(quitFrom)).toMatch(/\[docker\] compose .* stop/);

  const before2 = logLines();
  const s2 = await launch("smoke-2");
  const page2 = await appReady(s2);
  const v2 = page2.video();
  if (v2) videos.push(v2);
  const tail2 = logFrom(before2);
  say(`relaunch compose subcommands: ${[...tail2.matchAll(/\[docker\] compose .*? --ansi never (\S+)/g)].map((m) => m[1]).join(" ")}`);
  expect(tail2).toMatch(/\[docker\] compose .* start env=/);
  expect(tail2).not.toMatch(/\[docker\] compose .* up -d/);
  expect(fp(s2.stack()?.launchToken ?? "")).toBe(fp(t1));
  expect(inspect("agent", "{{.Created}}")).toBe(created1);
  await expect(page2.locator("#rail")).toBeVisible({ timeout: 60_000 });
  const chats = (await page2.evaluate(() => fetch("/api/chats").then((r) => r.json()))) as { items: { title: string }[] };
  say(`after relaunch: same tokenFp ${fp(t1)}, Created unchanged, chats: ${chats.items.map((c) => c.title).join(" | ")}`);
  expect(JSON.stringify(chats)).toContain(word);
  await close();
  expect(states()).toEqual(["agent=exited", "renderer=exited", "search=exited"]);

  const all = readFileSync(join(env.stateDir, "logs/shell.log"), "utf8") + readFileSync(join(env.stateDir, "status.json"), "utf8");
  expect(all).not.toContain(t1);
  keepEvidence("smoke");
  const [first, ...rest] = videos;
  if (first) await first.saveAs(join(EVIDENCE, "..", "real.webm"));
  for (const [i, v] of rest.entries()) await v.saveAs(join(EVIDENCE, `smoke-video-${i + 2}.webm`));
  writeFileSync(join(EVIDENCE, "smoke-summary.txt"), `growth ${growth.join(",")}\nfinal ${final}\nreport ${report?.id}\n`);
});

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { LATEST_PATH } from "../../apps/desktop/test/support/mockReleases.ts";
import { lastReplyLength, send, status, stubBaseUrl } from "../support/localStack";
import { LONG_MARKER } from "../support/stubModel";
import {
  appMenu,
  captionOn,
  clickMenu,
  composeDown,
  hold,
  ids,
  nameOk,
  portOk,
  quitWatching,
  rangeOk,
  realDocker,
  say,
} from "./support/demo";
import { DESKTOP, ROOT } from "./support/fakeDocker";
import { launchShell, type Shell, type ShellEnv } from "./support/launch";
import { onboardWithStub } from "./support/onboard";
import { DOCKER, docker, ENGINE, firstPort, projectStates, shellExtra } from "./support/real";

const DEMO_M5 = process.env.DEMO_M5 === "1";
const OUT = resolve(process.env.DEMO_OUT ?? join(ROOT, ".factory/m5/demo"));
const PROJECT = process.env.DEMO_PROJECT ?? "oab-factory-m5-demo";
const RANGE = process.env.DEMO_RANGE ?? "18515-18519";
const STUB_PORT = Number(process.env.DEMO_STUB_PORT ?? 18503);
const RELEASES_PORT = Number(process.env.DEMO_RELEASES_PORT ?? 18502);
const LOCK = resolve(process.env.DEMO_LOCK ?? join(ROOT, ".factory/m5/release-dry-run/0.0.0-dryrun.1/lock/services.lock.json"));
const NEXT = process.env.DEMO_UPDATE_VERSION ?? "0.0.0-dryrun.2";
const DOCS_DIR = resolve(process.env.DEMO_DOCS_DIR ?? join(OUT, "docs"));
const STATE = resolve(process.env.DEMO_STATE ?? join(OUT, "state-app"));
const STAGED_LOCK = join(DESKTOP, "build/stack/services.lock.json");
const M5_PORTS = [18500, 18549] as const;
const LOCAL_REF = /^127\.0\.0\.1:18501\/oab-m5-[a-z0-9-]+@sha256:[0-9a-f]{64}$/;
const DRY_RUN = /^0\.0\.0-dryrun\.\d+$/;
const SERVICES = ["agent", "search", "renderer"] as const;

type Lock = { kind: string; version: string; images: { agent: string; search: string } };

const inM5 = (p: number, what: string) => {
  portOk(p, what);
  if (p < M5_PORTS[0] || p > M5_PORTS[1]) throw new Error(`${what} must be inside ${M5_PORTS.join("-")}, got ${p}`);
  return p;
};
const listening = (port: number) =>
  new Promise<boolean>((res) => {
    const s = createConnection({ host: "127.0.0.1", port });
    s.once("connect", () => {
      s.destroy();
      res(true);
    });
    s.once("error", () => res(false));
  });
const presentDigests = () =>
  realDocker(["image", "ls", "-a", "--digests", "--format", "{{.Repository}}@{{.Digest}}"])
    .out.split("\n")
    .filter((l) => l.includes("oab-m5-"));
const api = <T>(page: Page, path: string) => page.evaluate((p) => fetch(p).then((r) => r.json()), path) as Promise<T>;
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

test.describe("M5 app", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!DEMO_M5, "the M5 demo runs only with DEMO_M5=1 (scripts/demo/m5/part-7.sh)");

  let env: ShellEnv;
  let shell: Shell | undefined;
  let lock: Lock;

  const appReady = async (s: Shell, timeout = 600_000): Promise<Page> => {
    await expect.poll(() => s.status()?.screen, { timeout, intervals: [500] }).toBe("app");
    return s.appPage();
  };
  const openServices = async (s: Shell, page: Page) => {
    await page.locator("#account-menu-button").click();
    await page.locator("#account-menu-services").click();
    const sp = await s.waitScreen("screen-services", 30_000);
    await expect(sp.locator("#screen-services-services-agent-state")).toHaveText("running · healthy", { timeout: 60_000 });
    return sp;
  };
  const versions = async (sp: Page) =>
    Object.fromEntries(
      await Promise.all(
        SERVICES.map(async (k) => [k, (await sp.locator(`#screen-services-services-${k}-version`).textContent())?.trim() ?? ""] as const),
      ),
    );
  const watchPull = async (s: Shell, sp: Page) => {
    const bars = new Set<string>();
    const deadline = Date.now() + 900_000;
    while (Date.now() < deadline && s.status()?.screen !== "app") {
      const d = await sp
        .locator("#screen-progress-download-detail")
        .textContent({ timeout: 300 })
        .catch(() => null);
      if (d && /layer \d+ of \d+/.test(d)) bars.add(d);
      const screen = s.status()?.screen;
      if (screen?.startsWith("screen-") && !["screen-progress", "screen-services"].includes(screen))
        throw new Error(`unexpected ${screen}`);
      await sp.waitForTimeout(200);
    }
    return [...bars];
  };

  test.beforeAll(async () => {
    nameOk(PROJECT, "DEMO_PROJECT");
    rangeOk(RANGE, "DEMO_RANGE");
    for (const p of RANGE.split("-").map(Number)) inM5(p, "DEMO_RANGE");
    inM5(STUB_PORT, "DEMO_STUB_PORT");
    inM5(RELEASES_PORT, "DEMO_RELEASES_PORT");
    if (!DRY_RUN.test(NEXT)) throw new Error(`DEMO_UPDATE_VERSION must be 0.0.0-dryrun.N, got ${NEXT}`);
    if (!existsSync(LOCK)) throw new Error(`DEMO_LOCK ${LOCK} does not exist (run dry run A first)`);
    lock = JSON.parse(readFileSync(LOCK, "utf8")) as Lock;
    if (lock.kind !== "release" || !DRY_RUN.test(lock.version))
      throw new Error(`DEMO_LOCK must be a dry-run release lock, got ${lock.kind} ${lock.version}`);
    for (const ref of [lock.images.agent, lock.images.search])
      if (!LOCAL_REF.test(ref)) throw new Error(`DEMO_LOCK refs must be 127.0.0.1:18501/oab-m5-…@sha256 refs, got ${ref}`);
    if (!existsSync(STAGED_LOCK) || !readFileSync(STAGED_LOCK).equals(readFileSync(LOCK)))
      throw new Error(`apps/desktop/build/stack/services.lock.json is not DEMO_LOCK: run stage-stack.mjs --lock ${LOCK}`);
    const present = presentDigests();
    for (const ref of [lock.images.agent, lock.images.search])
      if (present.includes(ref)) throw new Error(`${ref} is already present; remove it so the fresh launch downloads it`);
    if (!(await listening(STUB_PORT))) throw new Error(`no stub model on 127.0.0.1:${STUB_PORT}`);
    if (!(await listening(RELEASES_PORT))) throw new Error(`no mock release on 127.0.0.1:${RELEASES_PORT}`);
    if (existsSync(STATE) && readdirSync(STATE).length > 0) throw new Error(`DEMO_STATE ${STATE} must be fresh (empty or absent)`);
    const volumes = docker(["volume", "ls", "--format", "{{.Name}}"]).split("\n");
    if (volumes.includes(`${PROJECT}-data`) || volumes.includes(`${PROJECT}-keys`))
      throw new Error(`${PROJECT} volumes exist; tear them down first`);
    mkdirSync(OUT, { recursive: true });
    env = {
      stateDir: STATE,
      project: PROJECT,
      portRange: RANGE,
      docker: DOCKER,
      externalLog: join(OUT, "external.log"),
      savePath: join(OUT, "saved.bin"),
      extra: { ...shellExtra(), OPEN_AGENT_SHELL_RELEASES_URL: `http://127.0.0.1:${RELEASES_PORT}${LATEST_PATH}` },
    };
    rmSync(env.externalLog, { force: true });
    say(`M5 app: project ${PROJECT}, range ${RANGE}, state ${STATE}`);
    say(`M5 app: staged lock = DEMO_LOCK (${lock.kind} ${lock.version}); agent ${lock.images.agent}; search ${lock.images.search}`);
  });

  test.afterAll(async () => {
    if (shell) await quitWatching(shell).catch(() => {});
    composeDown({ project: PROJECT, stateDir: STATE, port: firstPort(RANGE) });
    say(`teardown: ${PROJECT} down -v, volumes removed; ${PROJECT} containers now ${projectStates(PROJECT).length}`);
  });

  test("M5 app 1. fresh launch with the staged dry-run lock: Docker check, download bars, Starting, the app", async () => {
    test.setTimeout(1_200_000);
    shell = await launchShell(env, test.info(), { video: "m5-01-fresh" });
    const s = shell;
    const sp = await s.shellPage();
    await expect(sp.locator("#test-mode-label")).toHaveText("TEST MODE");
    const bars = await watchPull(s, sp);
    say(`1: download values (${bars.length}): ${bars.slice(0, 8).join(" | ")}`);
    expect(bars.length).toBeGreaterThanOrEqual(3);
    await expect(sp.locator("#screen-progress-docker-detail")).toHaveText(`${ENGINE} is running`);
    const page = await appReady(s);
    const pulls = s
      .log()
      .split("\n")
      .filter((l) => /\[docker\] pull /.test(l));
    for (const l of pulls) say(`1: ${l.replace(/^.*\[docker\] /, "[docker] ")}`);
    for (const ref of [lock.images.agent, lock.images.search]) expect(pulls.some((l) => l.includes(ref))).toBe(true);
    const health = await api<{ version: string }>(page, "/health");
    say(`1: app on ${page.url()}; /health version ${health.version}`);
    expect(health.version).toBe(lock.version);
    await hold(page, 6);
  });

  test("M5 app 2. onboarding with the stub model and a streamed reply", async () => {
    test.setTimeout(600_000);
    const page = await (shell as Shell).appPage();
    await onboardWithStub(page, stubBaseUrl({ STUB_HOST: process.env.STUB_HOST ?? "host.docker.internal", STUB_PORT: String(STUB_PORT) }));
    say("2: onboarding done with the stub model");
    await send(page, `What should I pack for a lighthouse visit? ${LONG_MARKER}`);
    const growth: number[] = [];
    const deadline = Date.now() + 120_000;
    while (growth.length < 4) {
      if (Date.now() > deadline) throw new Error(`the reply did not grow (${growth.join(", ")})`);
      const n = await lastReplyLength(page);
      if (n > (growth.at(-1) ?? 0)) growth.push(n);
      await page.waitForTimeout(250);
    }
    say(`2: reply lengths while streaming: ${growth.join(", ")}`);
    await expect(status(page)).toBeHidden({ timeout: 120_000 });
    await hold(page, 8);
  });

  test("M5 app 3. Services & data lists agent, search and renderer at the dry-run version", async () => {
    test.setTimeout(300_000);
    const s = shell as Shell;
    const sp = await openServices(s, await s.appPage());
    for (const k of SERVICES) await expect(sp.locator(`#screen-services-services-${k}-version`)).toHaveText(lock.version);
    say(`3: services: ${oneLine(await sp.locator("#screen-services-services").innerText())}`);
    say(`3: versions ${JSON.stringify(await versions(sp))}`);
    await ids(sp, "screen-services");
    await captionOn(sp, "demo-m5-caption", `Services & data: agent, search, renderer at ${lock.version}`);
    await hold(sp, 10);
    await sp.locator("#screen-services-close").click();
    await expect.poll(() => s.status()?.screen).toBe("app");
  });

  test(`M5 app 4. Check for updates… → the menu offers ${NEXT} → Update services → rows at ${NEXT}`, async () => {
    test.setTimeout(1_200_000);
    const s = shell as Shell;
    await clickMenu(s.app, "menu-check-updates");
    await expect
      .poll(async () => (await appMenu(s.app)).find((i) => i.id === "menu-update")?.label, { timeout: 60_000 })
      .toBe(`Open Agent ${NEXT} is available…`);
    say(`4: app menu: ${(await appMenu(s.app)).map((i) => i.label || `(${i.id || "separator"})`).join(" | ")}`);
    await clickMenu(s.app, "menu-update");
    const sp = await s.waitScreen("screen-services");
    await expect(sp.locator("#update-row-text")).toHaveText(`Open Agent ${NEXT} is available`);
    await expect(sp.locator("#screen-services-update")).toHaveText(`Update services (${NEXT} available)`, { timeout: 60_000 });
    await ids(sp, "screen-services-update-row");
    await captionOn(sp, "demo-m5-caption", `the mock release (dry run B) offers ${NEXT}`);
    await hold(sp, 10);
    await sp.click("#screen-services-update");
    const bars = await watchPull(s, sp);
    say(`4: update pull progress (${bars.length}): ${bars.slice(0, 6).join(" | ")}`);
    const page = await appReady(s);
    const health = await api<{ version: string }>(page, "/health");
    say(`4: /health version ${health.version}`);
    expect(health.version).toBe(NEXT);
    const again = await openServices(s, page);
    for (const k of SERVICES) await expect(again.locator(`#screen-services-services-${k}-version`)).toHaveText(NEXT);
    say(`4: services: ${oneLine(await again.locator("#screen-services-services").innerText())}`);
    await again.locator("#screen-services-services").scrollIntoViewIfNeeded();
    await expect(again.locator("#screen-services-services")).toBeInViewport();
    await again.waitForTimeout(2_000);
    const updates = s
      .log()
      .split("\n")
      .filter((l) => /\[update\]|\[docker\] pull /.test(l))
      .slice(-6);
    for (const l of updates) say(`4: ${l.replace(/^.*?\[/, "[")}`);
    await captionOn(again, "demo-m5-caption", `after Update services: agent, search, renderer at ${NEXT}`);
    await hold(again, 10);
    await again.locator("#screen-services-close").click();
    await expect.poll(() => s.status()?.screen).toBe("app");
  });

  test("M5 app 5. quit with stop-on-quit: the containers exit", async () => {
    test.setTimeout(300_000);
    const s = shell as Shell;
    shell = undefined;
    const screens = await quitWatching(s);
    say(`5: quit screens ${screens.join(" → ")}`);
    expect(screens).toContain("screen-stopping");
    const states = projectStates(PROJECT);
    say(`5: ${states.join(" ")}`);
    expect(states).toEqual(["agent=exited", "renderer=exited", "search=exited"]);
  });
});

test.describe("M5 docs", () => {
  test.skip(!DEMO_M5, "the M5 docs viewer runs only with DEMO_M5=1 (scripts/demo/m5/part-8.sh)");
  const PAGES = ["index", "readme", "install", "releasing", "security"] as const;

  test("M5 docs: the rendered README, INSTALL, RELEASING and SECURITY pages, every element with a unique id", async ({ browser }) => {
    test.setTimeout(600_000);
    for (const p of PAGES)
      if (!existsSync(join(DOCS_DIR, `${p}.html`))) throw new Error(`${DOCS_DIR}/${p}.html is missing: run render-docs.mjs first`);
    const context = await browser.newContext({
      viewport: { width: 1200, height: 800 },
      recordVideo: { dir: test.info().outputPath("m5-docs"), size: { width: 1200, height: 800 } },
    });
    const page = await context.newPage();
    try {
      for (const p of PAGES) {
        await page.goto(`file://${join(DOCS_DIR, `${p}.html`)}`);
        await ids(page, `docs-${p}`);
        const count = await page.evaluate(() => document.querySelectorAll("[id]").length);
        const title = await page.title();
        say(`docs: ${title} — ${count} elements, all with unique ids`);
        await hold(page, 4);
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        for (let y = 0; y < height; y += 500) {
          await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
          await hold(page, 2);
        }
        await hold(page, 4);
      }
    } finally {
      await context.close();
    }
  });
});

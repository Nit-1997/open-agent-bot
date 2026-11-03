import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { LATEST_PATH, type MockReleases, startMockReleases } from "../../apps/desktop/test/support/mockReleases.ts";
import { lastReplyLength, send, status, stubBaseUrl } from "../support/localStack";
import { LONG_MARKER, REPORT_MARKER, type StubModel, startStubModel } from "../support/stubModel";
import {
  appMenu,
  captionOn,
  clickMenu,
  composeDown,
  DEMO_OUT,
  dockerLines,
  hold,
  ids,
  mutatingLines,
  nameOk,
  portOk,
  quitWatching,
  rangeOk,
  realDocker,
  rememberToken,
  say,
  screensChecked,
  waitForFile,
} from "./support/demo";
import {
  composeSha,
  createFakeDocker,
  FAKE_DIR,
  type FakeDocker,
  type FakeScenario,
  fakeServices,
  isMutating,
  type Recorder,
  ROOT,
  startRecorder,
  subOf,
} from "./support/fakeDocker";
import { launchShell, newStateDir, type Shell, type ShellEnv, spawnSecondInstance } from "./support/launch";
import { onboardWithStub } from "./support/onboard";
import { containerEnv, DOCKER, docker, ENGINE, firstPort, fp, projectStates, REAL, readServices, shellExtra } from "./support/real";

const WORDING = "Saved model keys are not included. Chats, reports and your profile are.";
const RELEASE_PAGE = "https://github.com/Nit-1997/open-agent-bot/releases/tag/v99.0.0";
const EXTERNAL = "https://example.com/oa-external";
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

const DEMO_REAL = process.env.DEMO_REAL === "1" && REAL;
const PROJECT = process.env.DEMO_PROJECT ?? "oab-factory-m4-demo";
const RANGE = process.env.DEMO_RANGE ?? "18460-18464";
const STUB_PORT = Number(process.env.DEMO_STUB_PORT ?? 18465);
const RELEASES_PORT = Number(process.env.DEMO_RELEASES_PORT ?? 18466);
const REGISTRY = process.env.DEMO_REGISTRY ?? "127.0.0.1:18467";
const FOREIGN_PORT = Number(process.env.DEMO_FOREIGN_PORT ?? 18468);
const FIREWALL_PORT = Number(process.env.DEMO_FIREWALL_PORT ?? 18469);
const SERVICES_A = process.env.DEMO_SERVICES ?? join(DEMO_OUT, "services.a.json");
const AGENT_B = process.env.DEMO_AGENT_B_REF ?? "";
const SEARCH_REF = process.env.DEMO_SEARCH_REF ?? "";
const VERSION_A = process.env.DEMO_VERSION_A ?? "0.0.0-m4a";
const VERSION_B = process.env.DEMO_VERSION_B ?? "0.0.0-m4b";
const STATE = process.env.DEMO_STATE ?? join(DEMO_OUT, "state");
const DATA = `${PROJECT}-data`;
const KEYS = `${PROJECT}-keys`;

const containerOf = (service: string) => `${PROJECT}-${service}-1`;
const inspect = (service: string, format: string) => docker(["inspect", "-f", format, containerOf(service)]).trim();
const agentEnv = (name: string) =>
  containerEnv(PROJECT, "agent")
    .find((e) => e.startsWith(`${name}=`))
    ?.slice(name.length + 1);
const logFrom = (from: number) => readFileSync(join(STATE, "logs/shell.log"), "utf8").split("\n").slice(from).join("\n");
const logLines = () =>
  existsSync(join(STATE, "logs/shell.log")) ? readFileSync(join(STATE, "logs/shell.log"), "utf8").split("\n").length - 1 : 0;
const api = <T>(page: Page, path: string) => page.evaluate((p) => fetch(p).then((r) => r.json()), path) as Promise<T>;

test.describe("part A: real Docker", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!DEMO_REAL, "part A runs only with DEMO_REAL=1 and DESKTOP_REAL_DOCKER=1");

  let env: ShellEnv;
  let shell: Shell | undefined;
  let stub: StubModel | undefined;
  let mock: MockReleases | undefined;
  let firewall: Recorder | undefined;
  let word = "";
  let reportId = "";
  let reportTitle = "";
  const tokens = join(DEMO_OUT, "previous-token.txt");

  const launch = async (video: string) => {
    shell = await launchShell(env, test.info(), { video });
    return shell;
  };
  const appReady = async (s: Shell, timeout = 600_000): Promise<Page> => {
    await expect.poll(() => s.status()?.screen, { timeout, intervals: [500] }).toBe("app");
    return s.appPage();
  };
  const quit = async () => {
    if (!shell) return [];
    const s = shell;
    rememberToken(tokens, s.stack()?.launchToken);
    shell = undefined;
    const screens = await quitWatching(s);
    say(`quit: screens ${screens.join(" → ")}`);
    return screens;
  };
  const openServices = async (s: Shell, page: Page) => {
    await page.locator("#account-menu-button").click();
    await expect(page.locator("#account-menu-services")).toHaveText("Services & data");
    await page.locator("#account-menu-services").click();
    const sp = await s.waitScreen("screen-services", 30_000);
    await expect(sp.locator("#screen-services-services-agent-state")).toHaveText("running · healthy", { timeout: 60_000 });
    return sp;
  };
  const closeServices = async (s: Shell, sp: Page) => {
    await sp.locator("#screen-services-close").click();
    await expect.poll(() => s.status()?.screen).toBe("app");
  };
  const setStopOnQuit = async (s: Shell, on: boolean) => {
    const sp = await openServices(s, await s.appPage());
    const box = sp.locator("#screen-services-stop-on-quit-input");
    if (on) await box.check();
    else await box.uncheck();
    await expect
      .poll(() => (JSON.parse(readFileSync(join(STATE, "settings.json"), "utf8")) as { stopOnQuit: boolean }).stopOnQuit)
      .toBe(on);
    say(`stop-on-quit ${on ? "on" : "off"} (settings.json)`);
    await hold(sp);
    await closeServices(s, sp);
  };
  const showReport = async (page: Page, label: string) => {
    const origin = new URL(page.url()).origin;
    await page.goto(`${origin}/reports`);
    await page.locator(`#reports-row-${reportId}-open`).click();
    await expect(page.locator("#report-detail-frame")).toHaveAttribute("src", new RegExp(`/api/artifacts/${reportId}`));
    say(`${label}: Reports lists "${reportTitle}" and its viewer shows /api/artifacts/${reportId}`);
    await hold(page, 8);
    const pdf = await page.evaluate(
      (id) =>
        fetch(`/api/artifacts/${id}?format=pdf`)
          .then((r) => r.arrayBuffer())
          .then((b) => ({ bytes: b.byteLength, head: new TextDecoder().decode(b.slice(0, 5)) })),
      reportId,
    );
    say(`${label}: its PDF is ${pdf.bytes} bytes, header ${JSON.stringify(pdf.head)}`);
    expect(pdf.head).toBe("%PDF-");
  };

  test.beforeAll(async () => {
    nameOk(PROJECT, "DEMO_PROJECT");
    nameOk(DATA, "data volume");
    nameOk(KEYS, "keys volume");
    rangeOk(RANGE, "DEMO_RANGE");
    for (const [p, what] of [
      [STUB_PORT, "DEMO_STUB_PORT"],
      [RELEASES_PORT, "DEMO_RELEASES_PORT"],
      [FOREIGN_PORT, "DEMO_FOREIGN_PORT"],
      [FIREWALL_PORT, "DEMO_FIREWALL_PORT"],
      [Number(REGISTRY.split(":")[1]), "DEMO_REGISTRY"],
    ] as const)
      portOk(p, what);
    if (!existsSync(SERVICES_A)) throw new Error(`DEMO_SERVICES (${SERVICES_A}) must be the services.a.json file`);
    const a = readServices(SERVICES_A);
    for (const ref of [a.images.agent, a.images.search, AGENT_B, SEARCH_REF])
      if (!new RegExp(`^${REGISTRY.replace(/\./g, "\\.")}/oab-[a-z0-9-]+@sha256:[0-9a-f]{64}$`).test(ref))
        throw new Error(
          `every demo image ref must be ${REGISTRY}/oab-…@sha256:<64 hex>; got "${ref}" (set DEMO_AGENT_B_REF and DEMO_SEARCH_REF)`,
        );
    if (existsSync(STATE) && readdirSync(STATE).length > 0) throw new Error(`DEMO_STATE ${STATE} must be fresh (empty or absent)`);
    const volumes = docker(["volume", "ls", "--format", "{{.Name}}"]).split("\n");
    if (volumes.includes(DATA) || volumes.includes(KEYS)) throw new Error(`${DATA}/${KEYS} already exist; tear them down first`);
    mkdirSync(DEMO_OUT, { recursive: true });
    rmSync(tokens, { force: true });
    stub = await startStubModel({ port: STUB_PORT, ...(process.env.STUB_BIND ? { bind: process.env.STUB_BIND } : {}) });
    mock = await startMockReleases({ port: RELEASES_PORT, log: join(DEMO_OUT, "mock-releases.jsonl") });
    firewall = await startRecorder(FIREWALL_PORT);
    env = {
      stateDir: STATE,
      project: PROJECT,
      portRange: RANGE,
      docker: DOCKER,
      services: SERVICES_A,
      externalLog: join(DEMO_OUT, "external.log"),
      savePath: join(DEMO_OUT, "saved.bin"),
      extra: { ...shellExtra(), OPEN_AGENT_SHELL_RELEASES_URL: mock.latestUrl },
    };
    rmSync(env.externalLog, { force: true });
    say(`part A: project ${PROJECT}, range ${RANGE}, state ${STATE}, services ${SERVICES_A}`);
  });

  test.afterAll(async () => {
    if (shell) await quitWatching(shell).catch(() => {});
    if (existsSync(join(STATE, "stack.json")))
      rememberToken(tokens, (JSON.parse(readFileSync(join(STATE, "stack.json"), "utf8")) as { launchToken?: string }).launchToken);
    await stub?.close();
    await mock?.stop();
    await firewall?.stop();
    composeDown({ project: PROJECT, stateDir: STATE, port: firstPort(RANGE) });
    say(`teardown: ${PROJECT} down -v, volumes removed; ${PROJECT} containers now ${projectStates(PROJECT).length}`);
  });

  test("1. fresh launch: Docker check, download bars with layer and byte counts, Starting rows healthy, the app view", async () => {
    test.setTimeout(900_000);
    const s = await launch("a01-fresh");
    const sp = await s.shellPage();
    await expect(sp.locator("#test-mode-label")).toHaveText("TEST MODE");
    const bars = new Set<string>();
    const starting = new Set<string>();
    const deadline = Date.now() + 600_000;
    while (Date.now() < deadline && s.status()?.screen !== "app") {
      const d = await sp
        .locator("#screen-progress-download-detail")
        .textContent({ timeout: 300 })
        .catch(() => null);
      if (d && /layer \d+ of \d+/.test(d)) bars.add(d);
      const st = await sp
        .locator("#screen-progress-start-detail")
        .textContent({ timeout: 300 })
        .catch(() => null);
      if (st) starting.add(st);
      const screen = s.status()?.screen;
      if (screen?.startsWith("screen-") && screen !== "screen-progress") throw new Error(`unexpected ${screen}`);
      await sp.waitForTimeout(200);
    }
    say(`1: Docker row "${await sp.locator("#screen-progress-docker-detail").textContent()}"`);
    say(`1: download values (${bars.size}): ${[...bars].slice(0, 8).join(" | ")}`);
    say(`1: Starting rows: ${[...starting].join(" | ")}`);
    expect(bars.size).toBeGreaterThanOrEqual(3);
    await expect(sp.locator("#screen-progress-docker-detail")).toHaveText(`${ENGINE} is running`);
    await ids(sp, "screen-progress");
    const page = await appReady(s);
    await expect(page.locator("#onboarding-step")).toBeVisible({ timeout: 60_000 });
    const t = s.stack()?.launchToken ?? "";
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(fp(agentEnv("OPEN_AGENT_LAUNCH_TOKEN") ?? "")).toBe(fp(t));
    const log = s.log();
    expect(log.indexOf(`[stack] port check ok 127.0.0.1:${s.stack()?.port}`)).toBeLessThan(log.indexOf("[app] cookie installed"));
    say(`1: app on ${page.url()}, tokenFp ${fp(t)} (= agent OPEN_AGENT_LAUNCH_TOKEN fp)`);
    await hold(page, 8);
  });

  test("2. onboarding with the stub, a streamed reply, a stub report in a new tab and its PDF", async () => {
    test.setTimeout(600_000);
    const s = shell as Shell;
    const page = await s.appPage();
    await onboardWithStub(page, stubBaseUrl({ STUB_HOST: process.env.STUB_HOST ?? "host.docker.internal", STUB_PORT: String(STUB_PORT) }));
    say("2: onboarding done with the stub model");
    word = `harbour${Date.now().toString(36)}`;
    await send(page, `Tell me about lighthouses ${word} ${LONG_MARKER}`);
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
    reportTitle = `Field notes ${word}`;
    await send(page, `${reportTitle} ${REPORT_MARKER}`);
    await expect(status(page)).toBeHidden({ timeout: 120_000 });
    await expect
      .poll(async () => (await api<{ items: { id: string; title: string }[] }>(page, "/api/reports")).items.map((r) => r.title), {
        timeout: 60_000,
      })
      .toContain(reportTitle);
    reportId =
      (await api<{ items: { id: string; title: string }[] }>(page, "/api/reports")).items.find((r) => r.title === reportTitle)?.id ?? "";
    say(`2: report ${reportId} "${reportTitle}"`);
    await hold(page, 6);

    const origin = new URL(page.url()).origin;
    const panel = page.locator("[id$='-report-panel-new-tab']:visible");
    const inPanel = await panel
      .first()
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (!inPanel) {
      await page.goto(`${origin}/reports`);
      await page.locator(`#reports-row-${reportId}-open`).click();
      await expect(page.locator("#report-detail-frame")).toHaveAttribute("src", new RegExp(`/api/artifacts/${reportId}`));
    }
    const prefix = inPanel ? ((await panel.first().getAttribute("id")) ?? "").replace(/-new-tab$/, "") : "report-detail";
    say(`2: the report is open in #${prefix}`);
    await hold(page, 6);
    const [report] = await Promise.all([s.app.waitForEvent("window"), page.locator(`#${prefix}-new-tab`).click()]);
    await expect.poll(() => report.url(), { timeout: 30_000 }).toBe(`${origin}/api/artifacts/${reportId}`);
    const samePartition = await s.app.evaluate(({ webContents, session }, id) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().endsWith(`/api/artifacts/${id}`));
      return wc?.session === session.fromPartition("persist:open-agent");
    }, reportId);
    say(`2: report window ${report.url()}, partition persist:open-agent: ${samePartition}`);
    expect(samePartition).toBe(true);
    await hold(report, 8);

    rmSync(env.savePath, { force: true });
    await page.locator(`#${prefix}-pdf`).click();
    const pdf = await waitForFile(env.savePath);
    const pdfFile = join(DEMO_OUT, "report.pdf");
    renameSync(env.savePath, pdfFile);
    say(`2: Download PDF saved ${pdf.length} bytes, header ${JSON.stringify(pdf.subarray(0, 5).toString())} → ${pdfFile}`);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const shown = await report
      .evaluate(async (id) => {
        const blob = await (await fetch(`/api/artifacts/${id}?format=pdf`)).blob();
        const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
        const frame = document.createElement("iframe");
        frame.id = "demo-pdf-frame";
        frame.src = url;
        frame.width = "100%";
        frame.height = "100%";
        document.body.replaceChildren(frame);
        return blob.size;
      }, reportId)
      .catch((e: unknown) => `not shown (${e instanceof Error ? e.message.split("\n")[0] : String(e)})`);
    await hold(report, 10);
    const pdfFrame = report.frames().find((f) => f.url().startsWith("blob:"));
    say(
      pdfFrame
        ? `2: the PDF (${shown} bytes) is shown in the report window in frame ${pdfFrame.url()}`
        : `2: the PDF is not shown in the report window: ${typeof shown === "number" ? "no blob frame loaded" : shown}; the report page CSP blocks it`,
    );
    await report.close();
  });

  test("3. navigation lockdown and the loopback firewall, live", async () => {
    const s = shell as Shell;
    const page = await s.appPage();
    const origin = new URL(page.url()).origin;
    const port = Number(new URL(page.url()).port);
    await page.evaluate((href) => {
      const a = document.createElement("a");
      a.id = "demo-external-link";
      a.href = href;
      a.target = "_blank";
      a.textContent = "example.com (external)";
      document.body.prepend(a);
    }, EXTERNAL);
    await page.locator("#demo-external-link").click();
    const opened = await page.evaluate((href) => {
      for (let i = 0; i < 20; i++) window.open(href);
      return window.open("/x") === null ? "null" : "a window";
    }, EXTERNAL);
    await page.waitForTimeout(1500);
    say(`3: external log after the link and a 20-call window.open loop: ${JSON.stringify(s.externalLog())}; window.open("/x") → ${opened}`);
    expect(s.externalLog()).toEqual([EXTERNAL]);
    expect(opened).toBe("null");
    const fw = `127.0.0.1:${FIREWALL_PORT}`;
    const results = await page.evaluate(async (target) => {
      const out: string[] = [];
      out.push(
        await fetch(`http://${target}/hit-fetch`).then(
          (r) => `fetch ${r.status}`,
          (e: Error) => `fetch failed ${e.name}`,
        ),
      );
      out.push(
        await new Promise<string>((res) => {
          const ws = new WebSocket(`ws://${target}/hit-ws`);
          ws.onopen = () => res("ws opened");
          ws.onerror = () => res("ws failed");
        }),
      );
      out.push(
        await new Promise<string>((res) => {
          const img = document.createElement("img");
          img.id = "demo-firewall-img";
          img.onload = () => res("img loaded");
          img.onerror = () => res("img failed");
          img.src = `http://${target}/hit-img.png`;
          document.body.append(img);
        }),
      );
      return out;
    }, fw);
    await page.waitForTimeout(500);
    say(`3: to ${fw}: ${results.join(", ")}; recorder hits ${firewall?.hits()}`);
    expect(results).toEqual(["fetch failed TypeError", "ws failed", "img failed"]);
    expect(firewall?.hits()).toBe(0);
    await captionOn(page, "demo-firewall-hits", `firewall listener on ${fw}: ${firewall?.hits()} hits`);
    say(
      `3: [firewall] cancel lines: ${
        s
          .log()
          .split("\n")
          .filter((l) => l.includes("[firewall] cancel")).length
      }`,
    );
    await hold(page, 10);
    for (const target of [`http://localhost:${port}/`, `http://127.0.0.1:${STUB_PORT}/`]) {
      await page.evaluate((t) => {
        location.href = t;
      }, target);
      await page.waitForTimeout(500);
      say(`3: location.href = ${target} → the view stays on ${page.url()}`);
      expect(new URL(page.url()).origin).toBe(origin);
    }
    expect(s.log()).toMatch(/\[nav\] deny/);
    await page.goto(`${origin}/`);
  });

  test("4. Services & data: rows, engine, logs with the filter, Save logs, export without keys", async () => {
    test.setTimeout(300_000);
    const s = shell as Shell;
    const sp = await openServices(s, await s.appPage());
    await expect(sp.locator("#screen-services-services-agent-version")).toHaveText(VERSION_A);
    await expect(sp.locator("#screen-services-services-renderer-version")).toHaveText(VERSION_A);
    await expect(sp.locator("#screen-services-engine-engine-value")).toHaveText(ENGINE);
    await expect(sp.locator("#screen-services-engine-socket-value")).toContainText("(owned by you)");
    await expect(sp.locator("#screen-services-data-volume-value")).toHaveText(DATA, { timeout: 60_000 });
    say(`4: services: ${(await sp.locator("#screen-services-services").innerText()).replace(/\s+/g, " ")}`);
    say(`4: engine: ${(await sp.locator("#screen-services-engine").innerText()).replace(/\s+/g, " ")}`);
    say(`4: data: ${(await sp.locator("#screen-services-data").innerText()).replace(/\s+/g, " ")}`);
    await ids(sp, "screen-services");
    await hold(sp, 8);
    await sp.locator("#screen-services-logs").click();
    await s.waitScreen("screen-logs");
    await sp.locator("#screen-logs-text-requests").check();
    await expect(sp.locator("#screen-logs-text-pre")).toContainText("[http]");
    await ids(sp, "screen-logs");
    await hold(sp, 6);
    rmSync(env.savePath, { force: true });
    await sp.locator("#screen-logs-save").click();
    await expect(sp.locator("#screen-logs-notice")).toContainText("Logs saved to");
    const saved = readFileSync(env.savePath, "utf8");
    expect(saved.startsWith("== service logs ==")).toBe(true);
    expect(saved).toContain("== shell.log ==");
    renameSync(env.savePath, join(DEMO_OUT, "saved-logs.txt"));
    say(`4: Save logs → saved-logs.txt (${saved.length} bytes, both sections)`);
    await sp.locator("#screen-logs-back").click();
    await s.waitScreen("screen-services");
    await sp.locator("#screen-services-export").click();
    await expect(sp.locator("#screen-services-notice")).toContainText(WORDING, { timeout: 180_000 });
    say(`4: export notice: ${await sp.locator("#screen-services-notice").innerText()}`);
    renameSync(env.savePath, join(DEMO_OUT, "export.zip"));
    const argv = s
      .log()
      .split("\n")
      .find((l) => /\[docker\] run --rm -i --network none .* export/.test(l));
    say(`4: export argv: ${argv?.replace(/^.*\[docker\] /, "")}`);
    expect(argv).toContain(`-v ${DATA}:/data`);
    expect(argv).not.toContain("/keys");
    await hold(sp, 8);
    await closeServices(s, sp);
  });

  test("5. quit with stop-on-quit → exited; relaunch starts only; off → still running; relaunch makes no mutating call", async () => {
    test.setTimeout(600_000);
    const s1 = shell as Shell;
    const t1 = s1.stack()?.launchToken ?? "";
    const created = inspect("agent", "{{.Created}}");
    const screens = await quit();
    expect(screens).toContain("screen-stopping");
    const ps = realDocker(["compose", "-p", PROJECT, "ps", "-a", "--format", "{{.Service}} {{.State}}"]);
    say(`5: docker compose -p ${PROJECT} ps -a (exit ${ps.status}):\n${ps.out.trim()}`);
    expect(projectStates(PROJECT)).toEqual(["agent=exited", "renderer=exited", "search=exited"]);

    let from = logLines();
    const s2 = await launch("a05-relaunch-stopped");
    const page2 = await appReady(s2);
    const tail2 = logFrom(from);
    say(
      `5: relaunch docker mutations: ${mutatingLines(tail2)
        .map((l) => l.replace(/^.*\[docker\] /, "").slice(0, 140))
        .join(" | ")}`,
    );
    expect(tail2).toMatch(/\[docker\] compose .* start env=/);
    expect(tail2).not.toMatch(/\[docker\] compose .* up -d/);
    expect(fp(s2.stack()?.launchToken ?? "")).toBe(fp(t1));
    expect(inspect("agent", "{{.Created}}")).toBe(created);
    say(`5: same tokenFp ${fp(t1)}, agent Created unchanged ${created}`);
    await showReport(page2, "5 (after start)");
    await setStopOnQuit(s2, false);
    await quit();
    say(`5: after quit with stop-on-quit off: ${projectStates(PROJECT).join(" ")}`);
    expect(projectStates(PROJECT)).toEqual(["agent=running", "renderer=running", "search=running"]);
    const started = inspect("agent", "{{.State.StartedAt}}");

    from = logLines();
    const s3 = await launch("a05-relaunch-running");
    const page3 = await appReady(s3);
    const tail3 = logFrom(from);
    say(`5: relaunch onto the running stack: ${dockerLines(tail3).length} docker lines, ${mutatingLines(tail3).length} mutating`);
    expect(mutatingLines(tail3)).toEqual([]);
    expect(inspect("agent", "{{.State.StartedAt}}")).toBe(started);
    expect(fp(s3.stack()?.launchToken ?? "")).toBe(fp(t1));
    say(`5: StartedAt unchanged ${started}`);
    await showReport(page3, "5 (attached)");
  });

  test("6. new version, then a service update from the release manifest", async () => {
    test.setTimeout(900_000);
    const s = shell as Shell;
    if (!mock) throw new Error("no mock");
    mock.release({ tag_name: "v99.0.0", html_url: RELEASE_PAGE, draft: false, prerelease: false, assets: [] });
    await clickMenu(s.app, "menu-check-updates");
    await expect
      .poll(async () => (await appMenu(s.app)).find((i) => i.id === "menu-update")?.label, { timeout: 30_000 })
      .toBe("Open Agent 99.0.0 is available…");
    say(`6: app menu: ${(await appMenu(s.app)).map((i) => i.label || `(${i.id || "separator"})`).join(" | ")}`);
    await clickMenu(s.app, "menu-update");
    const sp = await s.waitScreen("screen-services");
    await expect(sp.locator("#update-row")).toBeInViewport();
    await expect(sp.locator("#update-row-text")).toHaveText("Open Agent 99.0.0 is available");
    await ids(sp, "screen-services-update-row");
    await hold(sp, 8);
    await sp.click("#update-row-download");
    await expect.poll(() => s.externalLog()).toContain(RELEASE_PAGE);
    say(`6: Download → external log ${JSON.stringify(s.externalLog())}`);

    const asset = mock.asset("open-agent-services.json", {
      schema: 1,
      kind: "dev",
      version: VERSION_B,
      composeSha256: composeSha(),
      images: { agent: AGENT_B, search: SEARCH_REF },
      pull: true,
      minShellVersion: "0.0.0-dev",
    });
    mock.release({
      tag_name: `v${VERSION_B}`,
      html_url: `https://github.com/Nit-1997/open-agent-bot/releases/tag/v${VERSION_B}`,
      draft: false,
      prerelease: false,
      assets: [{ name: "open-agent-services.json", browser_download_url: asset }],
    });
    say(`6: the mock's latest is now v${VERSION_B} with open-agent-services.json (agent ${AGENT_B})`);
    await sp.click("#screen-services-check-check");
    await expect(sp.locator("#screen-services-update")).toHaveText(`Update services (${VERSION_B} available)`, { timeout: 30_000 });
    await hold(sp, 8);
    await sp.click("#screen-services-update");
    const seen = new Set<string>();
    const deadline = Date.now() + 600_000;
    while (Date.now() < deadline && s.status()?.screen !== "app") {
      const t = await sp
        .locator("#screen-progress-download-detail")
        .textContent({ timeout: 300 })
        .catch(() => null);
      if (t && /layer \d+ of \d+/.test(t)) seen.add(t);
      await sp.waitForTimeout(200);
    }
    say(`6: update pull progress (${seen.size}): ${[...seen].slice(0, 6).join(" | ")}`);
    const page = await appReady(s);
    const health = await api<{ version: string }>(page, "/health");
    say(`6: /health.version ${health.version}`);
    expect(health.version).toBe(VERSION_B);
    const again = await openServices(s, page);
    await expect(again.locator("#screen-services-services-agent-version")).toHaveText(VERSION_B);
    say(`6: services: ${(await again.locator("#screen-services-services").innerText()).replace(/\s+/g, " ")}`);
    expect(mock.requests().some((r) => r.path === LATEST_PATH)).toBe(true);
    await hold(again, 8);
    await closeServices(s, again);
    rememberToken(tokens, s.stack()?.launchToken);
  });

  test("7. kek_missing: the refusal names 1 saved key → Reset → typed reset → one up with RESET → no saved key", async () => {
    test.setTimeout(600_000);
    const s = shell as Shell;
    const page = await s.appPage();
    const before = JSON.stringify(await api<unknown>(page, "/api/providers"));
    await setStopOnQuit(s, true);
    await quit();
    expect(projectStates(PROJECT)).toEqual(["agent=exited", "renderer=exited", "search=exited"]);
    nameOk(KEYS, "keys volume");
    const rm = realDocker(["run", "--rm", "-v", `${KEYS}:/keys`, "alpine", "rm", "/keys/kek"]);
    say(`7: docker run --rm -v ${KEYS}:/keys alpine rm /keys/kek → exit ${rm.status}`);
    expect(rm.status).toBe(0);
    const from = logLines();
    const s2 = await launch("a07-kek-missing");
    const refusal = await s2.waitScreen("screen-refusal-kek_missing", 180_000);
    await expect(refusal.locator("#screen-refusal-kek_missing-count")).toHaveText(
      "1 saved model key can't be unlocked because the key file is gone.",
    );
    say(`7: ${await refusal.locator("#screen-refusal-kek_missing-line").innerText()}`);
    await ids(refusal, "screen-refusal-kek_missing");
    await hold(refusal, 8);
    await refusal.click("#screen-refusal-kek_missing-reset");
    const confirm = await s2.waitScreen("screen-confirm-reset");
    await confirm.fill("#screen-confirm-reset-type-input", "reset");
    await ids(confirm, "screen-confirm-reset");
    await hold(confirm, 4);
    await confirm.click("#screen-confirm-reset-confirm");
    const page2 = await appReady(s2);
    const after = JSON.stringify(await api<unknown>(page2, "/api/providers"));
    const ups = logFrom(from).match(/\[stack\] up with OPEN_AGENT_RESET_CREDENTIALS=1/g) ?? [];
    say(`7: ups with OPEN_AGENT_RESET_CREDENTIALS=1: ${ups.length}; agent env RESET=${agentEnv("OPEN_AGENT_RESET_CREDENTIALS")}`);
    say(`7: providers before ${before.slice(0, 200)}`);
    say(`7: providers after  ${after.slice(0, 200)}`);
    expect(ups).toHaveLength(1);
    expect(after).not.toBe(before);
    const origin = new URL(page2.url()).origin;
    await page2.goto(`${origin}/models`).catch(() => {});
    await hold(page2, 8);
    await page2.goto(`${origin}/`);
  });

  test("8. a foreign stack from the repo compose file → the foreign screen, read-only until Use the app's services", async () => {
    test.setTimeout(600_000);
    await quit();
    nameOk(PROJECT, "project");
    portOk(FOREIGN_PORT, "foreign port");
    const up = realDocker(
      [
        "compose",
        "-p",
        PROJECT,
        "-f",
        join(ROOT, "docker-compose.yml"),
        "--env-file",
        "/dev/null",
        "up",
        "-d",
        "--no-build",
        "--wait",
        "--wait-timeout",
        "300",
      ],
      {
        OPEN_AGENT_PORT: String(FOREIGN_PORT),
        OPEN_AGENT_DATA_VOLUME: DATA,
        OPEN_AGENT_KEYS_VOLUME: KEYS,
        OPEN_AGENT_IMAGE: AGENT_B,
        OPEN_AGENT_SEARCH_IMAGE: SEARCH_REF,
      },
    );
    say(`8: docker compose -p ${PROJECT} -f <repo>/docker-compose.yml up -d (port ${FOREIGN_PORT}) → exit ${up.status}`);
    expect(up.status).toBe(0);
    const from = logLines();
    const s = await launch("a08-foreign");
    const page = await s.waitScreen("screen-foreign-stack", 120_000);
    await expect(page.locator("#screen-foreign-stack-details-dir-value")).toHaveText(ROOT);
    await expect(page.locator("#screen-foreign-stack-details-port-value")).toHaveText(String(FOREIGN_PORT));
    await ids(page, "screen-foreign-stack");
    await hold(page, 10);
    const tail = logFrom(from);
    say(`8: before the click: ${dockerLines(tail).length} docker lines, mutating: ${mutatingLines(tail).length}`);
    expect(mutatingLines(tail)).toEqual([]);
    await page.click("#screen-foreign-stack-use");
    const app = await appReady(s);
    expect(new URL(app.url()).port).not.toBe(String(FOREIGN_PORT));
    const chats = await api<{ items: { title: string }[] }>(app, "/api/chats");
    say(
      `8: app on ${app.url()}; chats: ${chats.items.map((c) => c.title).join(" | ")}; RESET=${JSON.stringify(agentEnv("OPEN_AGENT_RESET_CREDENTIALS"))}`,
    );
    expect(JSON.stringify(chats)).toContain(word);
    expect(agentEnv("OPEN_AGENT_RESET_CREDENTIALS")).toBe("");
    await hold(app, 8);
  });

  test("9. a listener on the persisted port → port conflict → Pick another port", async () => {
    test.setTimeout(600_000);
    const port = shell?.stack()?.port ?? 0;
    await quit();
    const blocker = await startRecorder(portOk(port, "persisted port"));
    try {
      const s = await launch("a09-port-conflict");
      const page = await s.waitScreen("screen-port-conflict", 120_000);
      say(`9: ${await page.locator("#screen-port-conflict-title").innerText()}`);
      await ids(page, "screen-port-conflict");
      await hold(page, 8);
      await page.click("#screen-port-conflict-pick");
      const app = await appReady(s);
      say(`9: the app loads on ${app.url()} (persisted ${s.stack()?.port})`);
      expect(s.stack()?.port).toBe(port + 1);
      await hold(app, 6);
    } finally {
      await blocker.stop();
    }
  });

  test("10. stale stack: stack.json deleted while running → token_mismatch, one recreate, a new token", async () => {
    test.setTimeout(600_000);
    const s = shell as Shell;
    const before = s.stack()?.launchToken ?? "";
    await setStopOnQuit(s, false);
    await quit();
    expect(projectStates(PROJECT)).toEqual(["agent=running", "renderer=running", "search=running"]);
    rmSync(join(STATE, "stack.json"));
    say("10: removed state/stack.json with the stack running");
    const from = logLines();
    const s2 = await launch("a10-stale");
    const app = await appReady(s2);
    const tail = logFrom(from);
    const recreates = tail.split("\n").filter((l) => /\[docker\] compose .* up -d .*--force-recreate/.test(l));
    say(
      `10: ${tail.includes("[stack] stale: token_mismatch") ? "[stack] stale: token_mismatch" : "no stale line"}; recreates ${recreates.length}`,
    );
    expect(tail).toContain("[stack] stale: token_mismatch");
    expect(tail).not.toContain("foreign");
    expect(recreates).toHaveLength(1);
    expect(fp(s2.stack()?.launchToken ?? "")).not.toBe(fp(before));
    expect(await app.evaluate(() => fetch("/api/chats").then((r) => r.status))).toBe(200);
    say(`10: new tokenFp ${fp(s2.stack()?.launchToken ?? "")} (was ${fp(before)}); /api/chats 200`);
    writeFileSync(join(DEMO_OUT, "agent-logs.txt"), realDocker(["logs", containerOf("agent")]).out, { mode: 0o600 });
    await hold(app, 6);
  });

  test("11. Delete all data → typed delete → fresh onboarding; both volumes gone, then recreated empty", async () => {
    test.setTimeout(600_000);
    const s = shell as Shell;
    await setStopOnQuit(s, true);
    const sp = await openServices(s, await s.appPage());
    await sp.locator("#screen-services-delete").click();
    await s.waitScreen("screen-confirm-delete");
    await sp.locator("#screen-confirm-delete-type-input").fill("delete");
    await ids(sp, "screen-confirm-delete");
    await hold(sp, 6);
    rememberToken(tokens, s.stack()?.launchToken);
    const from = logLines();
    await sp.locator("#screen-confirm-delete-confirm").click();
    const page = await appReady(s);
    await expect(page.locator("#onboarding-step")).toBeVisible({ timeout: 60_000 });
    const tail = logFrom(from);
    const downAt = tail.search(/\[docker\] compose .* down -v --remove-orphans/);
    const rmAt = tail.search(new RegExp(`\\[docker\\] volume rm ${DATA} ${KEYS}`));
    say(`11: down -v at ${downAt}, volume rm at ${rmAt} in the log tail`);
    expect(downAt).toBeGreaterThanOrEqual(0);
    expect(rmAt).toBeGreaterThan(downAt);
    const chats = await api<{ items: unknown[] }>(page, "/api/chats");
    const vols = docker(["volume", "ls", "--format", "{{.Name}}"])
      .split("\n")
      .filter((v) => v === DATA || v === KEYS);
    say(`11: GET /api/chats → ${chats.items.length} chats; volumes now: ${vols.join(", ")} (recreated empty by the new start)`);
    expect(chats.items).toEqual([]);
    await hold(page, 8);
  });

  test("12. quit with stop-on-quit on", async () => {
    const s = shell as Shell;
    writeFileSync(
      join(DEMO_OUT, "agent-logs.txt"),
      `${readFileSync(join(DEMO_OUT, "agent-logs.txt"), "utf8")}${realDocker(["logs", containerOf("agent")]).out}`,
      {
        mode: 0o600,
      },
    );
    rememberToken(tokens, s.stack()?.launchToken);
    const current = s.stack()?.launchToken ?? "";
    const screens = await quit();
    expect(screens).toContain("screen-stopping");
    say(`12: ${projectStates(PROJECT).join(" ")}`);
    expect(projectStates(PROJECT)).toEqual(["agent=exited", "renderer=exited", "search=exited"]);
    const previous = readFileSync(tokens, "utf8")
      .split("\n")
      .filter((t) => t && t !== current);
    writeFileSync(tokens, `${previous.join("\n")}\n`, { mode: 0o600 });
    chmodSync(tokens, 0o600);
    say(`12: ${previous.length} previous tokens saved 0600 to previous-token.txt (never printed)`);
  });
});

test.describe("part B: fake docker", () => {
  test.describe.configure({ mode: "serial" });

  let env: ShellEnv;
  let fake: FakeDocker | undefined;
  let shell: Shell | undefined;
  let nextPort = 18470;
  const takePort = () => {
    const p = nextPort;
    nextPort = nextPort >= 18478 ? 18470 : nextPort + 2;
    return `${p}-${p + 1}`;
  };
  const project = "oab-demo-fake";
  const out = join(DEMO_OUT, "part-b");

  const setup = async (label: string, scenario: FakeScenario = {}, o: { extra?: Record<string, string>; docker?: string } = {}) => {
    const stateDir = newStateDir(`demo-${label}`);
    fake = await createFakeDocker(`demo-${label}`, { pull: { layers: 3, msPerLayer: 200 }, ...scenario });
    env = {
      stateDir,
      project,
      portRange: takePort(),
      docker: o.docker ?? fake.bin,
      services: fakeServices(stateDir),
      externalLog: join(stateDir, "external.log"),
      savePath: join(stateDir, "saved.bin"),
      ...(o.extra ? { extra: o.extra } : {}),
    };
  };
  const launch = async (video: string) => {
    shell = await launchShell(env, test.info(), { video });
    const sp = await shell.shellPage();
    await expect(sp.locator("#test-mode-label")).toHaveText("TEST MODE");
    return shell;
  };
  const close = async () => {
    await shell?.app.close().catch(() => {});
    shell = undefined;
  };
  const cleanup = async () => {
    await close();
    await fake?.cleanup();
    fake = undefined;
    if (env) rmSync(env.stateDir, { recursive: true, force: true });
  };
  const ready = async (s: Shell): Promise<Page> => {
    await expect.poll(() => s.status()?.screen, { timeout: 40_000 }).toBe("app");
    const page = await s.appPage();
    await expect(page.locator("#fa-heading")).toBeVisible();
    return page;
  };
  const services = async (s: Shell) => {
    const app = await ready(s);
    await app.locator("#fa-open-services").click();
    const page = await s.waitScreen("screen-services");
    await expect(page.locator("#screen-services-services-agent-state")).toHaveText("running · healthy");
    return page;
  };
  const fakeOf = () => fake as FakeDocker;
  const composeCount = () =>
    fakeOf()
      .calls()
      .filter((c) => c.argv[0] === "compose").length;

  test.beforeAll(() => {
    mkdirSync(join(out, "refusals"), { recursive: true });
  });

  test.afterEach(async () => {
    if (test.info().status !== test.info().expectedStatus) process.stdout.write(`--- shell.log\n${shell?.log() ?? ""}\n`);
    await cleanup();
  });

  test("13. no Docker CLI → the missing screen → Get OrbStack; a staff group-writable candidate is rejected", async () => {
    const planted = join(newStateDir("demo-planted"), "bin");
    mkdirSync(planted);
    chmodSync(planted, 0o775);
    writeFileSync(join(planted, "docker"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const group = statSync(planted).gid;
    await setup("missing", {}, { docker: join(planted, "docker") });
    const s = await launch("b13-docker-missing");
    const page = await s.waitScreen("screen-docker-missing");
    await expect(page.locator("#screen-docker-missing-rejected-0")).toHaveText(
      `Skipped ${join(planted, "docker")}: parent ${planted} is group-writable`,
    );
    say(
      `13: ${await page.locator("#screen-docker-missing-searched-0").innerText()}; ${await page.locator("#screen-docker-missing-rejected-0").innerText()} (gid ${group})`,
    );
    await ids(page, "screen-docker-missing");
    await hold(page, 6);
    await page.click("#screen-docker-missing-get-orbstack");
    await expect.poll(() => s.externalLog()).toEqual(["https://orbstack.dev/"]);
    say(`13: Get OrbStack → external log ${JSON.stringify(s.externalLog())}; docker calls ${fakeOf().calls().length}`);
    expect(fakeOf().calls()).toEqual([]);
    rmSync(join(planted, ".."), { recursive: true, force: true });
  });

  test("14. Docker not running → the stopped screen continues by itself when the daemon comes up", async () => {
    await setup("stopped");
    fakeOf().daemon("down");
    const s = await launch("b14-docker-stopped");
    const page = await s.waitScreen("screen-docker-stopped");
    await expect(page.locator("#screen-docker-stopped-title")).toHaveText("Docker isn't running");
    await ids(page, "screen-docker-stopped");
    await hold(page, 6);
    fakeOf().daemon("up");
    const at = Date.now();
    say("14: wrote daemon.txt=up");
    await expect.poll(() => s.status()?.screen, { timeout: 20_000 }).not.toBe("screen-docker-stopped");
    say(`14: continued after ${Date.now() - at} ms with no click`);
    expect(Date.now() - at).toBeLessThan(5_000);
    await hold(await ready(s), 4);
  });

  for (const endpoint of ["tcp", "foreignSocket"] as const) {
    test(`15. remote engine (${endpoint}) → screen-docker-remote with zero compose calls`, async () => {
      await setup(`remote-${endpoint}`, { endpoint });
      const s = await launch(`b15-remote-${endpoint}`);
      const page = await s.waitScreen("screen-docker-remote");
      say(
        `15: ${endpoint}: ${await page.locator("#screen-docker-remote-endpoint-endpoint-value").innerText()} (${await page.locator("#screen-docker-remote-endpoint-reason-value").innerText()})`,
      );
      await ids(page, "screen-docker-remote");
      await hold(page, 6);
      say(`15: compose calls in calls.jsonl: ${composeCount()}`);
      expect(composeCount()).toBe(0);
    });
  }

  test("16. Compose too old → screen-compose-old", async () => {
    await setup("compose-old", { composeVersion: "2.23.0" });
    const s = await launch("b16-compose-old");
    const page = await s.waitScreen("screen-compose-old");
    await expect(page.locator("#screen-compose-old-found")).toContainText("this Mac has 2.23.0");
    await ids(page, "screen-compose-old");
    say(`16: ${await page.locator("#screen-compose-old-found").innerText()}`);
    await hold(page, 6);
  });

  test("17. outside Applications → the move screen → Keep it here → relaunch without it", async () => {
    await setup("move", {}, { extra: { OPEN_AGENT_SHELL_FAKE_LOCATION: "outside" } });
    const s = await launch("b17-move");
    const page = await s.waitScreen("screen-move-to-applications");
    await ids(page, "screen-move-to-applications");
    await hold(page, 6);
    await page.click("#screen-move-to-applications-keep");
    await ready(s);
    expect(JSON.parse(readFileSync(join(env.stateDir, "settings.json"), "utf8")).keepOutsideApplications).toBe(true);
    await close();
    const s2 = await launch("b17-move-relaunch");
    await ready(s2);
    const last = s2.log().split("[app] start").at(-1) ?? "";
    say(`17: Keep it here remembered; the relaunch went straight to the app (move screen shown again: ${last.includes("screen-move")})`);
    expect(last).not.toContain("moveToApplications");
  });

  test("18. every refusal screen (78–86), db_newer export, db_corrupt without export, mismatch and crash", async () => {
    test.setTimeout(600_000);
    for (const code of CODES) {
      await setup(`refusal-${code}`, { agent: `refuse:${code}`, upFailMs: code === "db_newer" ? 500 : 8000 });
      const s = await launch(`b18-refusal-${code}`);
      const page = await s.waitScreen(`screen-refusal-${code}`);
      await expect(page.locator(`#screen-refusal-${code}-line`)).toHaveText(`[startup] refused code=${code} ${REFUSAL_MESSAGES[code]}`);
      await ids(page, `screen-refusal-${code}`);
      const shot = join(out, "refusals", `${code}.png`);
      await page.screenshot({ path: shot });
      say(`18: screen-refusal-${code} → ${shot}`);
      if (code === "db_corrupt") {
        await expect(page.locator("#screen-refusal-db_corrupt-export")).toHaveCount(0);
        say(`18: db_corrupt: ${await page.locator("#screen-refusal-db_corrupt-no-export").innerText()}`);
      }
      if (code === "db_newer") {
        await page.click("#screen-refusal-db_newer-export");
        await expect(page.locator("#screen-refusal-db_newer-notice")).toContainText(WORDING, { timeout: 20_000 });
        copyFileSync(env.savePath, join(out, "db_newer-snapshot.zip"));
        say(`18: db_newer → Export data → snapshot zip ${statSync(env.savePath).size} bytes`);
      }
      await hold(page, 3);
      await cleanup();
    }
    await setup("mismatch", { agent: "refuse:kek_missing", refuseExit: 78, upFailMs: 8000 });
    let s = await launch("b18-refusal-mismatch");
    let page = await s.waitScreen("screen-failed");
    await expect(page.locator("#screen-failed-detail")).toContainText("exit code 78; line [startup] refused code=kek_missing");
    await ids(page, "screen-failed-refusal_mismatch");
    say(`18: mismatch: ${await page.locator("#screen-failed-detail").innerText()}`);
    await hold(page, 4);
    await cleanup();
    await setup("crash", { agent: "crash:3", upFailMs: 8000 });
    s = await launch("b18-crash");
    page = await s.waitScreen("screen-failed");
    await expect(page.locator("#screen-failed-reason")).toHaveText("Reason: crashed, exit code 3");
    await ids(page, "screen-failed-crashed");
    say(`18: crash: ${await page.locator("#screen-failed-reason").innerText()}`);
    await hold(page, 4);
  });

  test("19. evil and withCredentials exports are rejected; a plain 401 changes nothing; launch_mismatch → Restart services", async () => {
    for (const mode of ["evil", "withCredentials"] as const) {
      await setup(`export-${mode}`, { export: mode });
      const s = await launch(`b19-export-${mode}`);
      const page = await services(s);
      await page.locator("#screen-services-export").click();
      await s.waitScreen("screen-failed");
      await expect(page.locator("#screen-failed-reason")).toContainText("export_invalid");
      say(
        `19: ${mode} export → ${await page.locator("#screen-failed-reason").innerText()}; file left: ${existsSync(env.savePath) || existsSync(`${env.savePath}.partial`)}`,
      );
      expect(existsSync(env.savePath)).toBe(false);
      expect(existsSync(`${env.savePath}.partial`)).toBe(false);
      await ids(page, "screen-failed-export_invalid");
      await hold(page, 4);
      await cleanup();
    }
    await setup("plain-401");
    let s = await launch("b19-plain-401");
    const app = await ready(s);
    expect(await app.evaluate(() => fetch("/api/flaky401").then((r) => r.status))).toBe(401);
    await expect.poll(() => s.log()).toContain("[app] probe status=200; ignored");
    say(`19: a plain 401 → probe 200, ignored; screen ${s.status()?.screen}`);
    expect(s.status()?.screen).toBe("app");
    await cleanup();
    await setup("mismatch-401", { agent: "mismatch" });
    s = await launch("b19-launch-mismatch");
    const app2 = await ready(s);
    expect(await app2.evaluate(() => fetch("/api/chats").then((r) => r.status))).toBe(401);
    const failed = await s.waitScreen("screen-failed");
    await expect(failed.locator("#screen-failed-title")).toHaveText("The services were started with a different key");
    await ids(failed, "screen-failed-launch_mismatch");
    await hold(failed, 6);
    fakeOf().scenario({ agent: "healthy" });
    await failed.click("#screen-failed-restart");
    const app3 = await ready(s);
    const st = await app3.evaluate(() => fetch("/api/chats").then((r) => r.status));
    say(`19: launch_mismatch → Restart services → /api/chats ${st}`);
    expect(st).toBe(200);
  });

  test("20. after-ready failures: daemon down and back, agent exit → Restart, renderer crash twice → ui_crashed", async () => {
    test.setTimeout(300_000);
    await setup("daemon-down", { afterReady: "daemonDown", afterReadyMs: 1500 });
    let s = await launch("b20-daemon-down");
    await ready(s);
    let page = await s.waitScreen("screen-services-stopped", 45_000);
    await expect(page.locator("#screen-services-stopped-title")).toHaveText("Docker stopped");
    await ids(page, "screen-services-stopped");
    await hold(page, 6);
    fakeOf().daemon("up");
    await expect.poll(() => s.status()?.screen, { timeout: 30_000 }).toBe("app");
    say("20: daemonDown → screen-services-stopped → daemon back → the app by itself");
    await cleanup();

    await setup("agent-exit", { afterReady: "agentExit:1", afterReadyMs: 1500 });
    s = await launch("b20-agent-exit");
    await ready(s);
    page = await s.waitScreen("screen-services-stopped", 45_000);
    await expect(page.locator("#screen-services-stopped-reason")).toHaveText("Reason: crashed, exit code 1");
    await ids(page, "screen-services-stopped-crashed");
    await hold(page, 6);
    await page.click("#screen-services-stopped-restart");
    await ready(s);
    say("20: agentExit:1 → Restart services → the app");
    await cleanup();

    await setup("ui-crash");
    s = await launch("b20-ui-crash");
    await ready(s);
    const crash = () =>
      (s as Shell).app.evaluate(({ webContents }) => {
        webContents
          .getAllWebContents()
          .find((w) => w.getURL().startsWith("http://127.0.0.1:"))
          ?.forcefullyCrashRenderer();
      });
    await crash();
    await expect.poll(() => s.log()).toContain("[app] app reloaded after renderer crash");
    await expect.poll(() => s.status()?.screen).toBe("app");
    await new Promise((r) => setTimeout(r, 1500));
    await crash();
    page = await s.waitScreen("screen-failed");
    await expect(page.locator("#screen-failed-title")).toHaveText("The Open Agent window crashed");
    await ids(page, "screen-failed-ui_crashed");
    say("20: two renderer crashes within 60 s → screen-failed ui_crashed");
    await hold(page, 6);
  });

  test("21. quit mid-operation: during a slow pull, during a slow up, during delete (pendingDelete)", async () => {
    test.setTimeout(300_000);
    await setup("quit-pull", { slow: { pullMs: 30_000 } });
    let s = await launch("b21-quit-pull");
    await expect.poll(() => s.status()?.phase, { timeout: 20_000 }).toBe("pulling");
    await (await s.shellPage()).waitForTimeout(1000);
    await close();
    const pull = fakeOf()
      .calls()
      .find((c) => c.argv[0] === "pull");
    say(
      `21: quit during pull: ${fakeOf()
        .calls()
        .map((c) => `${(c.argv[0] === "compose" ? c.argv.slice(11) : c.argv.slice(0, 2)).join(" ")}${c.signal ? ` (${c.signal})` : ""}`)
        .join(", ")}`,
    );
    expect(pull?.signal).toBe("SIGTERM");
    expect(
      fakeOf()
        .calls()
        .filter((c) => subOf(c) === "up"),
    ).toHaveLength(0);
    await cleanup();

    await setup("quit-up", { slow: { upMs: 30_000 } });
    s = await launch("b21-quit-up");
    await expect.poll(() => s.status()?.phase, { timeout: 20_000 }).toBe("creating");
    await (await s.shellPage()).waitForTimeout(1000);
    await close();
    const calls = fakeOf().calls();
    say(
      `21: quit during up: ${calls
        .filter((c) => c.argv[0] === "compose")
        .map((c) => `${c.argv.slice(11).join(" ")}${c.signal ? ` (${c.signal})` : ""}`)
        .join(", ")}`,
    );
    expect(calls.find((c) => subOf(c) === "up")?.signal).toBe("SIGTERM");
    expect(calls.filter((c) => subOf(c) === "stop").map((c) => c.argv.slice(11))).toEqual([["stop"]]);
    await cleanup();

    await setup("quit-delete");
    s = await launch("b21-quit-delete");
    const page = await services(s);
    await page.locator("#screen-services-delete").click();
    await s.waitScreen("screen-confirm-delete");
    await page.locator("#screen-confirm-delete-type-input").fill("delete");
    await page.locator("#screen-confirm-delete-confirm").click();
    await close();
    const pending = (JSON.parse(readFileSync(join(env.stateDir, "settings.json"), "utf8")) as { pendingDelete?: unknown }).pendingDelete;
    say(
      `21: quit right after confirming delete: ${pending ? "pendingDelete written; finished at the next launch" : "the delete finished before exit"}`,
    );
    const mark = fakeOf().calls().length;
    s = await launch("b21-quit-delete-relaunch");
    await ready(s);
    say(
      `21: relaunch: ${fakeOf()
        .calls()
        .slice(mark)
        .filter(isMutating)
        .map((c) => (c.argv[0] === "compose" ? c.argv.slice(11, 13) : c.argv.slice(0, 2)).join(" "))
        .join(", ")}`,
    );
    await close();
    await fake?.cleanup();

    const stateDir = env.stateDir;
    fake = await createFakeDocker("demo-pending", { pull: { layers: 1, msPerLayer: 10 } });
    env = { ...env, docker: fake.bin };
    writeFileSync(
      join(stateDir, "settings.json"),
      JSON.stringify({
        schema: 1,
        stopOnQuit: true,
        checkForUpdates: true,
        pendingDelete: { project, dataVolume: `${project}-data`, keysVolume: `${project}-keys`, at: new Date().toISOString() },
      }),
      { mode: 0o600 },
    );
    s = await launch("b21-pending-delete");
    await ready(s);
    const order = fakeOf()
      .calls()
      .filter((c) => ["down", "volume", "up"].includes(subOf(c) ?? ""))
      .map((c) => (c.argv[0] === "volume" ? c.argv.join(" ") : `compose ${c.argv.slice(11).join(" ")}`));
    say(`21: seeded pendingDelete → ${order.join(" → ")}`);
    expect(order[0]).toBe("compose down -v --remove-orphans");
    expect(order[1]).toBe(`volume rm ${project}-data ${project}-keys`);
    expect(order[2]).toMatch(/^compose up -d/);
    expect(JSON.parse(readFileSync(join(stateDir, "settings.json"), "utf8")).pendingDelete).toBeUndefined();
  });

  test("22. disk full from pull and from the export container → screen-disk-full", async () => {
    await setup("nospace-pull", { noSpace: "pull" });
    let s = await launch("b22-disk-full-pull");
    let page = await s.waitScreen("screen-disk-full");
    await expect(page.locator("#screen-disk-full-line")).toContainText("Disk usage limit");
    await ids(page, "screen-disk-full");
    say(
      `22: pull: ${await page.locator("#screen-disk-full-title").innerText()} — ${await page.locator("#screen-disk-full-line").innerText()}`,
    );
    await hold(page, 6);
    await cleanup();
    await setup("nospace-export", { noSpace: "export" });
    s = await launch("b22-disk-full-export");
    page = await services(s);
    await page.locator("#screen-services-export").click();
    await s.waitScreen("screen-disk-full");
    await expect(page.locator("#screen-disk-full-line")).toContainText("Disk usage limit");
    say(`22: export: ${await page.locator("#screen-disk-full-line").innerText()}; file written: ${existsSync(env.savePath)}`);
    expect(existsSync(env.savePath)).toBe(false);
    await hold(page, 6);
  });

  test("23. single instance: a second launch with extra argv exits; the first window is focused", async () => {
    await setup("single");
    const s = await launch("b23-single-instance");
    await ready(s);
    const started = Date.now();
    const second = spawnSecondInstance(env, ["--evil=1", "https://x.example/evil-argv"]);
    const code = await new Promise<number | null>((res) => second.once("exit", (c) => res(c)));
    await expect.poll(() => s.log()).toContain("[app] second-instance");
    const logs = readdirSync(join(env.stateDir, "logs"))
      .map((f) => readFileSync(join(env.stateDir, "logs", f), "utf8"))
      .join("\n");
    say(
      `23: second launch exited ${code} after ${Date.now() - started} ms; [app] second-instance logged; argv in logs: ${logs.includes("evil")}`,
    );
    expect(code).toBe(0);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(logs).not.toContain("evil");
    await hold(await s.appPage(), 4);
  });

  test("24. the ids sweep", () => {
    const screens = screensChecked();
    say(`24: everyElementHasUniqueId passed on ${screens.length} screens: ${screens.join(", ")}`);
    const digest = createHash("sha256").update(screens.join(",")).digest("hex").slice(0, 12);
    writeFileSync(join(out, "ids-sweep.txt"), `${screens.length} screens (${digest})\n${screens.join("\n")}\n`);
    expect(screens.length).toBeGreaterThanOrEqual(DEMO_REAL ? 30 : 20);
  });
});

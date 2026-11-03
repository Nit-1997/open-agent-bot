import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { FAKE_DIR, type FakeAgent, type Recorder, startFakeAgent, startRecorder } from "./support/fakeDocker";
import { everyElementHasUniqueId } from "./support/ids";
import { launchShell, newStateDir, type Shell, type ShellEnv, seedStack, spawnSecondInstance } from "./support/launch";

const PORT = 18420;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PROJECT = "oab-e2e-desktop-scaffold";
const SHELL_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";

let env: ShellEnv;
let token: string;
let agent: FakeAgent;
let recorder: Recorder;
let shell: Shell;

const must = <T>(v: T | undefined, what: string): T => {
  if (v === undefined) throw new Error(`missing ${what}`);
  return v;
};

const clickOut = async (page: Page, id: string, key: string) => {
  await page.click(`#${id}`);
  await expect.poll(() => page.evaluate((k) => (window as unknown as { __fa?: Record<string, unknown> }).__fa?.[k], key)).toBeDefined();
  return page.evaluate((k) => (window as unknown as { __fa: Record<string, unknown> }).__fa[k], key);
};

test.beforeEach(async () => {
  const info = test.info();
  const stateDir = newStateDir("scaffold");
  env = {
    stateDir,
    project: PROJECT,
    portRange: "18420-18429",
    attachPort: PORT,
    externalLog: join(stateDir, "external.log"),
    savePath: join(stateDir, "saved.bin"),
  };
  token = randomBytes(32).toString("hex");
  seedStack(stateDir, { project: PROJECT, port: PORT, token });
  agent = await startFakeAgent({ port: PORT, stackFile: join(stateDir, "stack.json") });
  recorder = await startRecorder(PORT + 1);
  shell = await launchShell(env, info);
});

test.afterEach(async () => {
  await shell?.app.close().catch(() => {});
  await agent?.stop();
  await recorder?.stop();
  const log = shell?.log() ?? "";
  expect(log).not.toContain(token);
  rmSync(env.stateDir, { recursive: true, force: true });
});

test("spike: Playwright sees both views and records them", async () => {
  const info = test.info();
  const shellPage = await shell.shellPage();
  const appPage = await shell.appPage();
  expect(
    shell.app
      .windows()
      .map((p) => p.url())
      .sort(),
  ).toEqual([`${ORIGIN}/`, "oa-shell://screens/index.html"]);
  expect(shell.app.context().pages()).toHaveLength(2);
  await expect(shellPage.locator("#screen-progress")).toBeAttached();
  await expect(appPage.locator("#fa-heading")).toHaveText(`Fake agent on ${PORT}`);
  await shell.app.close();
  const videos = readdirSync(info.outputPath("video")).filter((f) => f.endsWith(".webm"));
  expect(videos.length).toBeGreaterThanOrEqual(2);
  for (const v of videos) expect(statSync(info.outputPath("video", v)).size).toBeGreaterThan(0);
});

test("every webContents is hardened, including a report window", async () => {
  const appPage = await shell.appPage();
  const [report] = await Promise.all([shell.app.waitForEvent("window"), appPage.click("#fa-report")]);
  await expect(report.locator("#fa-report-heading")).toBeVisible();
  const prefs = await shell.app.evaluate(({ webContents }) =>
    webContents.getAllWebContents().map((w) => {
      const p = w.getLastWebPreferences();
      return {
        url: w.getURL(),
        sandbox: p?.sandbox,
        contextIsolation: p?.contextIsolation,
        nodeIntegration: p?.nodeIntegration,
        webviewTag: p?.webviewTag,
        nodeIntegrationInSubFrames: p?.nodeIntegrationInSubFrames,
        webSecurity: p?.webSecurity,
      };
    }),
  );
  expect(prefs.map((p) => p.url).sort()).toEqual([`${ORIGIN}/`, `${ORIGIN}/api/artifacts/AbCdEfGhIjKl`, "oa-shell://screens/index.html"]);
  for (const p of prefs)
    expect(p, p.url).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
    });
  const partition = await shell.app.evaluate(({ BrowserWindow, session }) => {
    const w = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes("/api/artifacts/"));
    return w?.webContents.session === session.fromPartition("persist:open-agent");
  });
  expect(partition).toBe(true);
});

test("the launch cookie lives only in persist:open-agent", async () => {
  const appPage = await shell.appPage();
  const cookies = await shell.app.evaluate(async ({ session }) => ({
    app: await session.fromPartition("persist:open-agent").cookies.get({ name: "oa_launch" }),
    shell: await session.fromPartition("shell").cookies.get({}),
    def: await session.defaultSession.cookies.get({}),
  }));
  expect(cookies.app).toHaveLength(1);
  expect(cookies.app[0]).toMatchObject({
    name: "oa_launch",
    value: token,
    httpOnly: true,
    sameSite: "strict",
    secure: false,
    session: true,
    domain: "127.0.0.1",
  });
  expect(cookies.shell).toEqual([]);
  expect(cookies.def).toEqual([]);
  expect(await appPage.evaluate(() => fetch("/api/whoami").then((r) => r.status))).toBe(200);
  const fromOthers = await shell.app.evaluate(async ({ session }, origin) => {
    const s = await session.fromPartition("shell").fetch(`${origin}/api/whoami`);
    const d = await session.defaultSession.fetch(`${origin}/api/whoami`);
    return { shell: s.status, def: d.status, body: await s.json() };
  }, ORIGIN);
  expect(fromOthers).toEqual({ shell: 401, def: 401, body: { error: "launch_required" } });
  expect(await appPage.evaluate(() => document.cookie)).toBe("");
});

test("navigation lockdown: external links leave, loopback and file stay, reports open in the partition", async () => {
  const appPage = await shell.appPage();
  await appPage.click("#fa-external-blank");
  await expect.poll(() => shell.externalLog()).toEqual(["https://example.com/oa-external"]);
  await new Promise((r) => setTimeout(r, 10_100));
  await appPage.click("#fa-external-same");
  await expect.poll(() => shell.externalLog()).toEqual(["https://example.com/oa-external", "https://example.com/oa-external"]);
  expect(appPage.url()).toBe(`${ORIGIN}/`);

  for (const target of [`http://localhost:${PORT}/`, `http://127.0.0.1:${PORT + 1}/`, "file:///etc/hosts"]) {
    await appPage.evaluate((t) => {
      location.href = t;
    }, target);
    await appPage.waitForTimeout(300);
    expect(appPage.url(), target).toBe(`${ORIGIN}/`);
  }
  await appPage.click("#fa-redirect");
  await appPage.waitForTimeout(500);
  expect(appPage.url()).toBe(`${ORIGIN}/`);
  expect(recorder.hits()).toBe(0);
  const denies = shell
    .log()
    .split("\n")
    .filter((l) => l.includes("[nav] deny"));
  expect(denies.some((l) => l.includes("http://localhost:18420"))).toBe(true);
  expect(denies.some((l) => l.includes("http://127.0.0.1:18421"))).toBe(true);
  expect(denies.some((l) => l.includes("file:"))).toBe(true);
  expect(denies.some((l) => l.includes("redirect"))).toBe(true);
  expect(shell.externalLog()).toHaveLength(2);

  expect(await clickOut(appPage, "fa-window-open", "windowOpen")).toBe("null");

  const [report] = await Promise.all([shell.app.waitForEvent("window"), appPage.click("#fa-report")]);
  await expect(report.locator("#fa-report-heading")).toHaveText("Report AbCdEfGhIjKl");
  expect(report.url()).toBe(`${ORIGIN}/api/artifacts/AbCdEfGhIjKl`);
  expect(await report.evaluate(() => fetch("/api/whoami").then((r) => r.status))).toBe(200);
});

test("downloads: same-origin saved to the test path, cross-origin cancelled, shell partition cancelled", async () => {
  const appPage = await shell.appPage();
  await appPage.click("#fa-download");
  await expect.poll(() => existsSync(env.savePath) && readFileSync(env.savePath, "utf8")).toBe("%PDF-1.4 fake\n");
  rmSync(env.savePath);
  await appPage.click("#fa-download-data");
  await expect.poll(() => shell.log()).toContain("[download] cancel persist:open-agent");
  await shell.app.evaluate(({ session }, origin) => session.fromPartition("shell").downloadURL(`${origin}/download/report.pdf`), ORIGIN);
  await expect.poll(() => shell.log()).toContain("[download] cancel shell");
  await shell.app.evaluate(({ session }, origin) => session.defaultSession.downloadURL(`${origin}/download/report.pdf`), ORIGIN);
  await expect.poll(() => shell.log()).toContain("[download] cancel default");
  expect(existsSync(env.savePath)).toBe(false);
});

test("shell actions: closed union, identity-checked, app view has only openServices", async () => {
  const shellPage = await shell.shellPage();
  const appPage = await shell.appPage();
  expect(
    await shellPage.evaluate(() => (window as unknown as { shell: { act(a: unknown): Promise<unknown> } }).shell.act({ type: "nope" })),
  ).toEqual({ ok: false, error: "invalid_action" });
  expect(
    await shellPage.evaluate(() =>
      (window as unknown as { shell: { act(a: unknown): Promise<unknown> } }).shell.act({ type: "deleteData", confirm: "delete" }),
    ),
  ).toEqual({ ok: false, error: "not_confirming" });
  expect(
    await shellPage.evaluate(() =>
      (window as unknown as { shell: { act(a: unknown): Promise<unknown> } }).shell.act({ type: "resetCredentials", confirm: "reset" }),
    ),
  ).toEqual({ ok: false, error: "not_confirming" });
  expect(shell.log()).toContain("[ipc] invalid_action");
  expect(await appPage.evaluate(() => typeof (window as unknown as { shell?: unknown }).shell)).toBe("undefined");
  expect(await appPage.evaluate(() => Object.keys((window as unknown as { openAgentDesktop: object }).openAgentDesktop))).toEqual([
    "openServices",
  ]);
  expect(await shellPage.evaluate(() => typeof (window as unknown as { openAgentDesktop?: unknown }).openAgentDesktop)).toBe("undefined");

  await shell.app.evaluate(
    ({ session }, file) => {
      session.fromPartition("persist:open-agent").registerPreloadScript({ type: "frame", id: "e2e-forge", filePath: file });
    },
    join(FAKE_DIR, "forge-preload.cjs"),
  );
  const [report] = await Promise.all([shell.app.waitForEvent("window"), appPage.click("#fa-report")]);
  await expect.poll(() => report.evaluate(() => (window as unknown as { __forge?: unknown }).__forge)).toBeDefined();
  const forged = await report.evaluate(() => (window as unknown as { __forge: unknown }).__forge);
  expect(forged).toEqual({ act: { ok: false, error: "forbidden" }, state: { ok: false, error: "forbidden" } });
  await expect.poll(() => shell.log()).toContain("[ipc] forbidden shell:act");
  await expect.poll(() => shell.log()).toContain("[ipc] forbidden app:open-services");
  expect(shell.app.windows().length).toBeGreaterThanOrEqual(3);
});

test("oa-shell is served only on the shell partition, with the strict CSP", async () => {
  const appPage = await shell.appPage();
  const handled = await shell.app.evaluate(({ session }) => ({
    shell: session.fromPartition("shell").protocol.isProtocolHandled("oa-shell"),
    app: session.fromPartition("persist:open-agent").protocol.isProtocolHandled("oa-shell"),
    def: session.defaultSession.protocol.isProtocolHandled("oa-shell"),
  }));
  expect(handled).toEqual({ shell: true, app: false, def: false });
  const fromApp = await appPage.evaluate(() =>
    fetch("oa-shell://screens/index.html").then(
      () => "loaded",
      (e) => `failed:${e.name}`,
    ),
  );
  expect(fromApp).toMatch(/^failed/);
  const loaded = await shell.app.evaluate(async ({ BaseWindow, WebContentsView }) => {
    const w = BaseWindow.getAllWindows()[0];
    const v = w?.contentView.children.find(
      (c): c is InstanceType<typeof WebContentsView> =>
        "webContents" in c && c.webContents.session.getStoragePath()?.includes("open-agent") === true,
    );
    if (!v) return "no-app-view";
    return v.webContents.loadURL("oa-shell://screens/index.html").then(
      () => v.webContents.getURL(),
      (e: Error) => `refused:${e.message.split(" ")[0]}`,
    );
  });
  expect(loaded).not.toBe("oa-shell://screens/index.html");
  await expect.poll(() => appPage.url()).toBe(`${ORIGIN}/`);
  const headers = await shell.app.evaluate(async ({ session }) => {
    const out: Record<string, Record<string, string>> = {};
    for (const path of ["index.html", "screens.js", "screens.css", "missing.html"]) {
      const r = await session.fromPartition("shell").fetch(`oa-shell://screens/${path}`);
      out[path] = {
        status: String(r.status),
        csp: r.headers.get("content-security-policy") ?? "",
        nosniff: r.headers.get("x-content-type-options") ?? "",
        cache: r.headers.get("cache-control") ?? "",
      };
    }
    return out;
  });
  for (const [path, h] of Object.entries(headers)) expect(h, path).toMatchObject({ csp: SHELL_CSP, nosniff: "nosniff", cache: "no-store" });
  expect(headers["missing.html"]?.status).toBe("404");
  expect(headers["index.html"]?.status).toBe("200");
});

test("shell screen: progress steps, test-mode label and title, every element id'd, no inline script", async () => {
  const shellPage = await shell.shellPage();
  await expect(shellPage.locator("#screen-progress")).toBeVisible();
  await expect(shellPage.locator("#screen-progress-title")).toHaveText("Getting your agent ready");
  await expect(shellPage.locator("#screen-progress-docker-label")).toHaveText("Docker");
  await expect(shellPage.locator("#screen-progress-download-label")).toHaveText("Downloading services");
  await expect(shellPage.locator("#screen-progress-start-label")).toHaveText("Starting");
  await expect(shellPage.locator("#test-mode-label")).toHaveText("TEST MODE");
  await everyElementHasUniqueId(shellPage);
  expect(await shellPage.evaluate(() => [...document.scripts].filter((s) => !s.src).length)).toBe(0);
  expect(await shellPage.evaluate(() => document.querySelectorAll("[style]").length)).toBe(0);
  const title = await shell.app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0]?.getTitle());
  expect(title).toBe("Open Agent — test");
  const state = await shellPage.evaluate(() => (window as unknown as { shell: { getState(): Promise<unknown> } }).shell.getState());
  expect(state).toMatchObject({ screen: "app", test: true, port: PORT });
});

test("loopback firewall: fetch, WebSocket and img to other local ports never leave", async () => {
  const appPage = await shell.appPage();
  for (const [id, key] of [
    ["fa-fw-fetch", "fetch"],
    ["fa-fw-fetch-localhost", "fetchLocalhost"],
    ["fa-fw-ws", "ws"],
    ["fa-fw-ws-localhost", "wsLocalhost"],
    ["fa-fw-img", "img"],
    ["fa-fw-img-localhost", "imgLocalhost"],
  ] as const) {
    const r = (await clickOut(appPage, id, key)) as { ok: boolean };
    expect(r.ok, key).toBe(false);
  }
  await appPage.waitForTimeout(500);
  expect(recorder.hits()).toBe(0);
  const lines = shell
    .log()
    .split("\n")
    .filter((l) => l.includes("[firewall] cancel"));
  for (const needle of [
    "http://127.0.0.1:18421/hit-fetch",
    "http://localhost:18420/health",
    "ws://127.0.0.1:18421/hit-ws",
    "ws://localhost:18420/hit-ws",
    "http://127.0.0.1:18421/hit-img.png",
    "http://localhost:18420/hit-img.png",
  ])
    expect(
      lines.some((l) => l.includes(needle)),
      needle,
    ).toBe(true);
});

test("openExternal guard: 20 scripted window.open calls reach the external log once", async () => {
  const appPage = await shell.appPage();
  expect(await clickOut(appPage, "fa-open-loop", "loop")).toBe("done");
  await appPage.waitForTimeout(1500);
  expect(shell.externalLog()).toEqual(["https://example.com/oa-loop"]);
  expect(shell.log()).toMatch(/\[external\] dropped (rate|duplicate)/);
});

test("devices, display media, notifications and geolocation are denied", async () => {
  const appPage = await shell.appPage();
  for (const [id, key] of [
    ["fa-hid", "hid"],
    ["fa-serial", "serial"],
    ["fa-usb", "usb"],
    ["fa-bluetooth", "bluetooth"],
    ["fa-display", "display"],
    ["fa-geo", "geo"],
  ] as const) {
    const r = (await clickOut(appPage, id, key)) as { ok: boolean; value?: string };
    expect(r.ok === false || r.value === "0", `${key}: ${JSON.stringify(r)}`).toBe(true);
  }
  expect(await clickOut(appPage, "fa-notify", "notify")).toEqual({ ok: true, value: "denied" });
  expect(shell.log()).toContain("[permission] deny");
});

test("subframes: a cross-origin iframe is cancelled, a same-origin one loads", async () => {
  const appPage = await shell.appPage();
  await appPage.evaluate(() => {
    for (const [id, src] of [
      ["fa-frame-cross", "https://example.com/oa-frame"],
      ["fa-frame-same", "/frame"],
    ] as const) {
      const f = document.createElement("iframe");
      f.id = id;
      f.src = src;
      document.body.append(f);
    }
  });
  await expect.poll(() => appPage.frames().some((f) => f.url() === `${ORIGIN}/frame`)).toBe(true);
  const same = appPage.frames().find((f) => f.url() === `${ORIGIN}/frame`);
  await expect(must(same, "same-origin frame").locator("#fa-frame-text")).toHaveText("same-origin frame");
  await expect.poll(() => shell.log()).toMatch(/\[nav\] deny app subframe https:\/\/example\.com/);
  expect(appPage.frames().some((f) => f.url().startsWith("https://example.com"))).toBe(false);
});

test("single instance: a second launch exits within 5 s, the first is focused, argv is never logged", async () => {
  await shell.appPage();
  const started = Date.now();
  const second = spawnSecondInstance(env, ["--evil=1", "https://x.example/evil-argv"]);
  const code = await new Promise<number | null>((res) => second.once("exit", (c) => res(c)));
  expect(code).toBe(0);
  expect(Date.now() - started).toBeLessThan(5_000);
  await expect.poll(() => shell.log()).toContain("[app] second-instance");
  const all = readdirSync(join(env.stateDir, "logs"))
    .map((f) => readFileSync(join(env.stateDir, "logs", f), "utf8"))
    .join("\n");
  expect(all).not.toContain("evil");
  expect(all).not.toContain("x.example");
});

test("state and logs are private: 0700 dirs, 0600 files", async () => {
  await shell.appPage();
  const mode = (p: string) => statSync(p).mode & 0o777;
  expect(mode(env.stateDir)).toBe(0o700);
  expect(mode(join(env.stateDir, "stack.json"))).toBe(0o600);
  expect(mode(join(env.stateDir, "logs"))).toBe(0o700);
  for (const f of readdirSync(join(env.stateDir, "logs"))) expect(mode(join(env.stateDir, "logs", f)), f).toBe(0o600);
});

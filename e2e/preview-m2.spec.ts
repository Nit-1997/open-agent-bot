import { readFile } from "node:fs/promises";
import { type APIResponse, expect, type Page, request, type TestInfo, test } from "@playwright/test";
import { completeOnboardingIfShown } from "./support/onboarding";
import { BIG_SUR_REPORT, SECOND_REPORT } from "./support/seed";
import { seeded } from "./support/state";

const composer = (page: Page) => page.locator("main [id$='-composer-input']:visible");
const status = (page: Page) => page.locator("[id$='-header-status']:visible");
const stopButton = (page: Page) => page.locator("main [id$='-composer-stop']:visible");
const banner = (page: Page) => page.locator("[id$='-error'][role=alert]");

const LONG_PROMPT = "Write a 600-word essay about lighthouses, in plain paragraphs.";
const FOLLOW_UP = "Reply with one short sentence about the sea.";
const POLL_MS = 75;
const NOT_FOUND = "This page doesn't exist.";
const FONT_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);
const EVIL = "https://evil.example";
const HOLD_MS = 1_500;

async function lastReplyLength(page: Page): Promise<number> {
  const article = page.locator("main [id$='-turns'] article:visible").last();
  if ((await article.count()) === 0) return 0;
  const reply = page.locator(`[id="${await article.getAttribute("id")}-body"]`);
  if ((await reply.count()) === 0) return 0;
  return (await reply.innerText()).trim().length;
}

async function send(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

async function noBannerFor(page: Page, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    expect(await banner(page).count()).toBe(0);
    await page.waitForTimeout(250);
  }
}

async function holdVisible(page: Page, selectors: readonly string[]): Promise<void> {
  for (const selector of selectors) await expect(page.locator(selector)).toBeVisible();
  await page.waitForTimeout(HOLD_MS);
  for (const selector of selectors) await expect(page.locator(selector)).toBeVisible();
}

async function errorCode(res: APIResponse): Promise<string> {
  try {
    const error = ((await res.json()) as { error?: unknown }).error;
    return typeof error === "string" ? error : "";
  } catch {
    return "";
  }
}

async function expectNotFound(page: Page, path: string): Promise<void> {
  const res = await page.goto(path);
  expect(res?.status(), path).toBe(404);
  await expect(page.locator("#shell-not-found-title")).toHaveText(NOT_FOUND);
  await expect(page.locator("[id^='admin-']")).toHaveCount(0);
  console.log(`${path} -> ${res?.status()}`);
}

function logger(testInfo: TestInfo) {
  const lines: string[] = [];
  return {
    log: (line: string) => {
      lines.push(line);
      console.log(line);
    },
    attach: (name: string) => testInfo.attach(name, { body: `${lines.join("\n")}\n`, contentType: "text/plain" }),
  };
}

test("preview: stop without a banner, reports and PDF, search, settings, 404s, fonts and refusals @m2", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(480_000);
  const app = baseURL as string;
  const s = seeded();
  const fontRequests: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (FONT_HOSTS.has(url.hostname) || (req.resourceType() === "font" && url.origin !== app)) fontRequests.push(req.url());
  });

  await test.step("1. Onboarding", async () => {
    await completeOnboardingIfShown(page);
    await expect(page.locator("#rail")).toBeVisible();
  });

  await test.step("2. A streamed reply, then Stop with no error banner", async () => {
    await page.locator("#sidebar-new-chat").click();
    await send(page, LONG_PROMPT);
    await expect(page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await expect(status(page)).toContainText("is working on this");
    const growth: number[] = [];
    const deadline = Date.now() + 120_000;
    while (growth.length < 2) {
      if (Date.now() > deadline) throw new Error(`the reply did not grow twice within 120 s (${growth.join(", ")})`);
      const length = await lastReplyLength(page);
      if (length > (growth.at(-1) ?? 0)) growth.push(length);
      await page.waitForTimeout(POLL_MS);
    }
    console.log(`reply lengths before stop: ${growth.join(", ")}`);
    await stopButton(page).click();
    await expect(stopButton(page)).toHaveCount(0, { timeout: 15_000 });
    await expect(status(page)).toBeHidden({ timeout: 15_000 });
    const stoppedAt = await lastReplyLength(page);
    expect(stoppedAt).toBeGreaterThan(0);
    await page.waitForTimeout(2_000);
    expect(await lastReplyLength(page)).toBe(stoppedAt);
    await noBannerFor(page, 5_000);
    expect(await lastReplyLength(page)).toBe(stoppedAt);
    console.log(`stopped at ${stoppedAt} characters; no banner for 5 s`);

    const turns = page.locator("main [id$='-turns'] article:visible");
    const before = await turns.count();
    await send(page, FOLLOW_UP);
    await expect(turns).toHaveCount(before + 1, { timeout: 30_000 });
    await expect(status(page)).toBeHidden({ timeout: 180_000 });
    await expect.poll(() => lastReplyLength(page), { timeout: 30_000 }).toBeGreaterThan(0);
    expect(await banner(page).count()).toBe(0);
  });

  await test.step("3. Reports, the report frame and the PDF through the bff", async () => {
    await page.goto("/reports");
    await expect(page.locator(`#reports-row-${BIG_SUR_REPORT.id}-title`)).toHaveText(BIG_SUR_REPORT.title);
    await expect(page.locator(`#reports-row-${SECOND_REPORT.id}-title`)).toHaveText(SECOND_REPORT.title);
    const framed = page.waitForResponse((res) => {
      const url = new URL(res.url());
      return url.pathname === `/api/artifacts/${BIG_SUR_REPORT.id}` && !url.searchParams.has("format");
    });
    await page.locator(`#reports-row-${BIG_SUR_REPORT.id}-open`).click();
    await expect(page).toHaveURL(new RegExp(`/reports/${BIG_SUR_REPORT.id}$`));
    await expect(page.locator("#report-detail-frame")).toHaveAttribute("src", new RegExp(`/api/artifacts/${BIG_SUR_REPORT.id}`));
    const frame = await framed;
    expect(frame.status()).toBe(200);
    expect(frame.headers()["content-type"]).toMatch(/^text\/html/);

    const pdfPath = `/api/artifacts/${BIG_SUR_REPORT.id}`;
    const download = page.waitForEvent("download");
    await page.locator("#report-detail-pdf").click();
    const file = await download;
    const url = new URL(file.url());
    expect(`${url.pathname}${url.search}`).toBe(`${pdfPath}?format=pdf`);
    expect(file.suggestedFilename()).toMatch(/\.pdf$/);
    const bytes = await readFile((await file.path()) as string);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const res = await page.request.get(file.url(), { timeout: 90_000 });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    expect((await res.body()).subarray(0, 5).toString()).toBe("%PDF-");
    console.log(`pdf ${url.pathname}${url.search} -> ${res.status()} ${res.headers()["content-type"]}, download ${bytes.length} bytes`);
  });

  await test.step("4. Search", async () => {
    await page.locator("#rail-search").click();
    const field = page.locator("#search-field-input");
    await expect(field).toBeFocused();
    await field.pressSequentially("big sur", { delay: 60 });
    await expect(page).toHaveURL(/\/search\?q=big(\+|%20)sur$/);
    const hits = [`#search-hit-chat-${s.bigSur}`, `#search-hit-report-${BIG_SUR_REPORT.id}`, `#search-hit-report-${SECOND_REPORT.id}`];
    await holdVisible(page, hits);
    const reportsTab = page.locator("#search-scopes-reports");
    await expect(reportsTab).toHaveText(/^Reports · \d+$/);
    const reports = Number((await reportsTab.innerText()).split("·")[1]);
    await reportsTab.click();
    await expect(page).toHaveURL(/scope=reports/);
    await expect(reportsTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#search-pager-range")).toHaveText(new RegExp(` of ${reports}$`));
    await expect(page.locator("#search-results > li[id^='search-hit-chat-']")).toHaveCount(0);
    await holdVisible(page, hits.slice(1));
    console.log(`search "big sur": ${reports} reports`);
    await page.locator(`#search-hit-report-${BIG_SUR_REPORT.id}-link`).click();
    await expect(page).toHaveURL(new RegExp(`/reports/${BIG_SUR_REPORT.id}$`));
    await expect(page.locator("#report-detail-frame")).toBeVisible();
  });

  await test.step("5. Settings and providers", async () => {
    await page.goto("/");
    await expect(page.locator("#rail")).toBeVisible();
    await page.locator("#account-menu-button").click();
    await page.locator("#account-menu-models").click();
    await expect(page.locator("#models-panel")).toBeVisible();
    await expect(page.locator("#provider-openrouter-status")).not.toHaveText("Not connected");
    await page.locator("#models-search").scrollIntoViewIfNeeded();
    await holdVisible(page, ["#models-search", "#models-search-title", "#models-search-brave", "#models-search-brave-status"]);
    await page.locator("#models-panel-close").click();
    await expect(page.locator("#models-panel")).toBeHidden();
    await page.locator("#account-menu-button").click();
    await page.locator("#account-menu-profile").click();
    await holdVisible(page, ["#profile-drawer", "#profile-drawer-title", "#profile-group-agent"]);
    await page.locator("#profile-group-model").scrollIntoViewIfNeeded();
    await holdVisible(page, ["#profile-drawer", "#profile-group-model", "#profile-model-options", "#profile-manage-models"]);
    await page.locator("#profile-drawer-close").click();
    await expect(page.locator("#profile-drawer")).toHaveCount(0);
  });

  await test.step("6. /admin and /nope answer 404", async () => {
    await expectNotFound(page, "/admin");
    await expectNotFound(page, "/nope");
  });

  await test.step("7. Fonts are self-hosted", async () => {
    await page.evaluate(() => document.fonts.ready);
    const fonts = await page.evaluate(() => ({
      body: getComputedStyle(document.body).fontFamily,
      title: getComputedStyle(document.getElementById("shell-not-found-title") as HTMLElement).fontFamily,
      display: [...document.querySelectorAll(".font-display")].map((el) => getComputedStyle(el).fontFamily),
      dmSans: document.fonts.check('16px "DM Sans Variable"'),
    }));
    console.log(`fonts: ${JSON.stringify(fonts)}`);
    expect(fonts.body).toMatch(/^"?DM Sans/);
    expect(fonts.title).toMatch(/^"?Instrument Serif/);
    for (const family of fonts.display) expect(family).toMatch(/^"?Instrument Serif/);
    expect(fonts.dmSans).toBe(true);
    expect(fontRequests).toEqual([]);
  });

  await test.step("8. Refusals through the web", async () => {
    const out = logger(testInfo);
    const line = async (name: string, res: APIResponse) => {
      const code = await errorCode(res);
      out.log(`${name} -> ${res.status()} ${code}`.trim());
      return { status: res.status(), code };
    };
    const anon = await request.newContext({ baseURL: app, storageState: { cookies: [], origins: [] } });
    try {
      expect(await line("no cookies GET /api/chats", await anon.get("/api/chats"))).toEqual({ status: 401, code: "signed_out" });
      expect(
        await line("no cookies POST /api/copilotkit/agent/openagent/run", await anon.post("/api/copilotkit/agent/openagent/run", { headers: { origin: app }, data: {} })),
      ).toEqual({ status: 401, code: "signed_out" });
    } finally {
      await anon.dispose();
    }
    const evil = { origin: EVIL };
    expect(await line("evil origin PUT /api/profile", await page.request.put("/api/profile", { headers: evil, data: {} }))).toEqual({ status: 403, code: "bad_origin" });
    expect(
      await line("evil origin POST /api/copilotkit/agent/openagent/run", await page.request.post("/api/copilotkit/agent/openagent/run", { headers: evil, data: {} })),
    ).toEqual({ status: 403, code: "bad_origin" });
    expect((await line("GET /api/copilotkit/threads", await page.request.get("/api/copilotkit/threads?agentId=openagent"))).status).toBe(404);
    expect((await line("PATCH /api/copilotkit/info", await page.request.patch("/api/copilotkit/info", { headers: { origin: app } }))).status).toBe(405);
    const info = await page.request.get("/api/copilotkit/info");
    out.log(`GET /api/copilotkit/info -> ${info.status()} cache-control: ${info.headers()["cache-control"]}`);
    expect(info.status()).toBe(200);
    expect(info.headers()["cache-control"]).toBe("private, no-store");
    expect(
      await line("POST /api/copilotkit/agent/openagent/run without threadId", await page.request.post("/api/copilotkit/agent/openagent/run", { headers: { origin: app }, data: {} })),
    ).toEqual({ status: 400, code: "invalid" });
    await out.attach("web refusals");
  });
});

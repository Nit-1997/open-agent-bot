import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { env } from "../support/env.ts";
import { lastReplyLength, noAlertFor, readMarker, saveMarker, send, status, stopButton, waitForReplyDone } from "../support/localStack.ts";
import terms from "./demoTerms.json" with { type: "json" };

const EVIL_PORT = 18399;
const POLL_MS = 75;
const HOLD_MS = 2_000;
const MARKER = "demo";

function evilPage(app: string): string {
  return `<!doctype html><html><head><title>Another website</title></head><body style="font:16px system-ui;padding:32px">
<h1 id="evil-title"></h1>
<p id="evil-result-fetch">fetch /api/chats → …</p>
<p id="evil-result-form">form POST → …</p>
<form id="evil-form" method="post" action="${app}/api/providers/openrouter/key" target="evil-sink">
<input id="evil-form-key" type="hidden" name="apiKey" value="not-a-key">
<button id="evil-form-submit" type="submit">Post a key from this page</button>
</form>
<iframe id="evil-sink" name="evil-sink" style="width:480px;height:80px"></iframe>
<script>
document.getElementById("evil-title").textContent = "Foreign page at " + location.origin;
fetch("${app}/api/chats", { credentials: "include" }).then(
  (r) => { document.getElementById("evil-result-fetch").textContent = "fetch /api/chats → readable " + r.status; },
  (e) => { document.getElementById("evil-result-fetch").textContent = "fetch /api/chats → blocked (" + e.name + ")"; },
);
</script></body></html>`;
}

async function serveEvil(app: string): Promise<Server> {
  const html = evilPage(app);
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise<void>((ok) => server.listen(EVIL_PORT, "127.0.0.1", () => ok()));
  return server;
}

async function growTwice(page: Page): Promise<number[]> {
  const growth: number[] = [];
  const deadline = Date.now() + 120_000;
  while (growth.length < 3) {
    if (Date.now() > deadline) throw new Error(`the reply did not grow within 120 s (${growth.join(", ")})`);
    const length = await lastReplyLength(page);
    if (length > (growth.at(-1) ?? 0)) growth.push(length);
    await page.waitForTimeout(POLL_MS);
  }
  return growth;
}

async function downloadPdf(page: Page): Promise<number> {
  const download = page.waitForEvent("download");
  await page.locator("#report-detail-pdf").click();
  const file = await download;
  expect(new URL(file.url()).search).toBe("?format=pdf");
  const bytes = await readFile((await file.path()) as string);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  return bytes.length;
}

test("local demo: no login, onboarding, streaming and stop, a report and its PDF, search, and foreign pages refused", async ({ page, baseURL }) => {
  test.setTimeout(600_000);
  const app = baseURL as string;

  await test.step("0. The OpenRouter key is saved through the API, same origin, before the UI opens", async () => {
    const res = await page.request.post("/api/providers/openrouter/key", { data: { apiKey: env("E2E_OPENROUTER_KEY") }, headers: { origin: app } });
    expect(res.status()).toBe(200);
  });

  await test.step("1. / shows onboarding with no login page or redirect", async () => {
    const res = await page.goto("/");
    expect(res?.status()).toBe(200);
    await expect(page.locator("#onboarding-step")).toBeVisible();
    expect(page.url()).toBe(`${app}/`);
  });

  await test.step("2. Onboarding: name, look, tone, an OpenRouter model, then the summary", async () => {
    for (let i = 0; i < 10; i++) {
      if (await page.locator("#agent-section-onboarding-name-input").isVisible()) {
        await page.locator("#agent-section-onboarding-name-input").fill("Sage");
        await page.locator("#agent-section-onboarding-look-ember").click();
        await page.locator("#agent-section-onboarding-tone-brief").click();
      }
      if (await page.locator("#onboarding-model-list").isVisible()) await page.getByRole("radio", { name: /DeepSeek V4 Flash/ }).click();
      if (await page.locator("#onboarding-summary").isVisible()) break;
      await page.locator("#onboarding-next").click();
    }
    await expect(page.locator("#onboarding-summary")).toContainText("Sage · brief · ember look");
    await page.waitForTimeout(HOLD_MS);
    await page.locator("#onboarding-next").click();
    await expect(page.locator("#rail")).toBeVisible();
  });

  await test.step("3. The account menu has no sign-out, admin or usage meter; OpenRouter shows connected", async () => {
    await page.locator("#account-menu-button").click();
    await expect(page.locator("#account-menu-list")).toBeVisible();
    await expect(page.locator("#account-menu-signout")).toHaveCount(0);
    await expect(page.locator("[id^='account-menu-admin']")).toHaveCount(0);
    await expect(page.locator("[id*='usage']")).toHaveCount(0);
    await page.waitForTimeout(HOLD_MS);
    await page.locator("#account-menu-models").click();
    await expect(page.locator("#provider-openrouter-status")).not.toHaveText("Not connected");
    await page.waitForTimeout(HOLD_MS);
    await page.locator("#models-panel-close").click();
  });

  let chatId = "";
  await test.step("4. A long reply streams; Stop holds the length with no error; a follow-up completes", async () => {
    await page.locator("#sidebar-new-chat").click();
    await send(page, terms.long);
    await expect(page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    chatId = new URL(page.url()).pathname.split("/").at(-1) as string;
    console.log(`reply lengths while streaming: ${(await growTwice(page)).join(", ")}`);
    await stopButton(page).click();
    await expect(stopButton(page)).toHaveCount(0, { timeout: 15_000 });
    await expect(status(page)).toBeHidden({ timeout: 15_000 });
    const stoppedAt = await lastReplyLength(page);
    await page.waitForTimeout(2_000);
    expect(await lastReplyLength(page)).toBe(stoppedAt);
    await noAlertFor(page, 5_000);
    const turns = page.locator("main [id$='-turns'] article:visible");
    const before = await turns.count();
    await send(page, terms.followUp);
    await expect(turns).toHaveCount(before + 1, { timeout: 30_000 });
    await waitForReplyDone(page, 180_000);
    await expect(page.locator("[role=alert]")).toHaveCount(0);
  });

  let reportId = "";
  await test.step("5. A report is created, opens from /reports, and its PDF downloads", async () => {
    await page.locator("#sidebar-new-chat").click();
    await send(page, terms.report);
    await expect(page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await waitForReplyDone(page, 300_000);
    const reports = (await (await page.request.get("/api/reports")).json()) as { items: Array<{ id: string; title: string }> };
    reportId = reports.items.find((r) => r.title.toLowerCase().includes(terms.search))?.id ?? "";
    expect(reportId, "a report whose title has the search keyword").not.toBe("");
    await page.goto("/reports");
    await page.locator(`#reports-row-${reportId}-open`).click();
    await expect(page.locator("#report-detail-frame")).toHaveAttribute("src", new RegExp(`/api/artifacts/${reportId}`));
    await page.waitForTimeout(HOLD_MS);
    console.log(`pdf ${await downloadPdf(page)} bytes`);
  });

  await test.step("6. Search lists the chat and the report; the reports scope updates the URL", async () => {
    await page.locator("#rail-search").click();
    await page.locator("#search-field-input").pressSequentially(terms.search, { delay: 60 });
    await expect(page.locator(`#search-hit-chat-${chatId}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(`#search-hit-report-${reportId}`)).toBeVisible();
    await page.locator("#search-scopes-reports").click();
    await expect(page).toHaveURL(/scope=reports/);
    await page.waitForTimeout(HOLD_MS);
  });

  saveMarker(app, { word: terms.search, chatId, reportId, reportTitle: "" }, MARKER);

  await test.step("7. Foreign pages: fetch blocked, form POST refused with 403", async () => {
    const server = await serveEvil(app);
    try {
      for (const foreign of [`http://127.0.0.1:${EVIL_PORT}/`, `http://localhost:${EVIL_PORT}/`]) {
        await page.goto(foreign);
        await expect(page.locator("#evil-title")).toHaveText(`Foreign page at ${foreign.slice(0, -1)}`);
        await expect(page.locator("#evil-result-fetch")).not.toHaveText("fetch /api/chats → …");
        const resp = page.waitForResponse((r) => r.url() === `${app}/api/providers/openrouter/key` && r.request().method() === "POST");
        await page.locator("#evil-form-submit").click();
        const status403 = (await resp).status();
        await page.evaluate((s) => {
          (document.getElementById("evil-result-form") as HTMLElement).textContent = `form POST → ${s}`;
        }, status403);
        expect(status403).toBe(403);
        await page.waitForTimeout(HOLD_MS);
        await expect(page.locator("#evil-result-fetch")).toContainText("blocked");
        console.log(`${foreign}: ${await page.locator("#evil-result-fetch").innerText()}; form POST → ${status403}`);
      }
    } finally {
      await new Promise<void>((ok) => server.close(() => ok()));
    }
  });
});

test("local demo after down and up: the chat, the report and the provider survive @after-restart", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const marker = readMarker(testInfo.project.use.baseURL as string, MARKER);

  await page.goto("/");
  await expect(page.locator("#rail")).toBeVisible();
  await page.locator("#rail-search").click();
  await page.locator("#search-field-input").pressSequentially(marker.word, { delay: 60 });
  await expect(page.locator(`#search-hit-chat-${marker.chatId}`)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(`#search-hit-report-${marker.reportId}`)).toBeVisible();
  await page.waitForTimeout(HOLD_MS);

  await page.goto("/reports");
  await page.locator(`#reports-row-${marker.reportId}-open`).click();
  await expect(page.locator("#report-detail-frame")).toHaveAttribute("src", new RegExp(`/api/artifacts/${marker.reportId}`));
  console.log(`pdf after restart ${await downloadPdf(page)} bytes`);

  await page.goto("/");
  await page.locator("#account-menu-button").click();
  await page.locator("#account-menu-models").click();
  await expect(page.locator("#provider-openrouter-status")).not.toHaveText("Not connected");
  await page.waitForTimeout(HOLD_MS);
  await page.locator("#models-panel-close").click();

  await page.goto(`/chats/${marker.chatId}`);
  const turns = page.locator("main [id$='-turns'] article:visible");
  await expect(turns.first()).toBeVisible();
  const before = await turns.count();
  await send(page, terms.afterRestart);
  await expect(turns).toHaveCount(before + 1, { timeout: 30_000 });
  await waitForReplyDone(page, 180_000);
  await expect(page.locator("[role=alert]")).toHaveCount(0);
});

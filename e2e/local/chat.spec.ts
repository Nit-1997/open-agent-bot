import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  completeLocalOnboarding,
  lastReplyLength,
  noAlertFor,
  saveMarker,
  send,
  status,
  stopButton,
  stubBaseUrl,
  waitForReplyDone,
} from "../support/localStack.ts";
import { LONG_MARKER, REPORT_MARKER } from "../support/stubModel.ts";

const POLL_MS = 75;
const CHAT_URL = /\/chats\/[0-9a-f-]{36}(\?.*)?$/;

test("local stack on the stub model: onboarding, streaming, stop, a report with its PDF, and search", async ({ page, baseURL }) => {
  test.setTimeout(300_000);
  const word = `lh${Date.now().toString(36)}`;
  const reportTitle = `Field notes ${word}`;

  await test.step("1. Onboarding connects the stub model as a custom provider, with no login", async () => {
    const res = await page.goto("/");
    expect(res?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe("/");
    expect(await completeLocalOnboarding(page, stubBaseUrl())).toBe(true);
    console.log(`onboarding done with ${stubBaseUrl()}`);
  });

  await test.step("2. A reply streams in growing lengths; Stop shows no error", async () => {
    await page.locator("#sidebar-new-chat").click();
    await send(page, `Tell me about lighthouses ${word} ${LONG_MARKER}`);
    await expect(page).toHaveURL(CHAT_URL, { timeout: 60_000 });
    const growth: number[] = [];
    const deadline = Date.now() + 60_000;
    while (growth.length < 3) {
      if (Date.now() > deadline) throw new Error(`the reply did not grow within 60 s (${growth.join(", ")})`);
      const length = await lastReplyLength(page);
      if (length > (growth.at(-1) ?? 0)) growth.push(length);
      await page.waitForTimeout(POLL_MS);
    }
    console.log(`reply lengths while streaming: ${growth.join(", ")}`);
    await stopButton(page).click();
    await expect(stopButton(page)).toHaveCount(0, { timeout: 15_000 });
    await expect(status(page)).toBeHidden({ timeout: 15_000 });
    const stoppedAt = await lastReplyLength(page);
    await noAlertFor(page, 5_000);
    expect(await lastReplyLength(page)).toBe(stoppedAt);
    console.log(`stopped at ${stoppedAt} characters; no alert for 5 s`);
  });

  await test.step("3. A follow-up completes", async () => {
    const turns = page.locator("main [id$='-turns'] article:visible");
    const before = await turns.count();
    await send(page, "One more short line, please.");
    await expect(turns).toHaveCount(before + 1, { timeout: 30_000 });
    await waitForReplyDone(page);
    await expect(page.locator("[role=alert]")).toHaveCount(0);
  });

  let chatId = "";
  let reportId = "";
  await test.step("4. The stub's scripted tool call creates a report; it opens and its PDF downloads", async () => {
    await page.locator("#sidebar-new-chat").click();
    await send(page, `${reportTitle} ${REPORT_MARKER}`);
    await expect(page).toHaveURL(CHAT_URL, { timeout: 60_000 });
    chatId = new URL(page.url()).pathname.split("/").at(-1) as string;
    await waitForReplyDone(page);
    const reports = (await (await page.request.get("/api/reports")).json()) as { items: Array<{ id: string; title: string }> };
    reportId = reports.items.find((r) => r.title === reportTitle)?.id ?? "";
    expect(reportId, "report created by the stub's tool call").not.toBe("");

    await page.goto("/reports");
    await expect(page.locator(`#reports-row-${reportId}-title`)).toHaveText(reportTitle);
    await page.locator(`#reports-row-${reportId}-open`).click();
    await expect(page).toHaveURL(new RegExp(`/reports/${reportId}$`));
    await expect(page.locator("#report-detail-frame")).toHaveAttribute("src", new RegExp(`/api/artifacts/${reportId}`));
    const download = page.waitForEvent("download");
    await page.locator("#report-detail-pdf").click();
    const file = await download;
    expect(new URL(file.url()).search).toBe("?format=pdf");
    const bytes = await readFile((await file.path()) as string);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    console.log(`report ${reportId}: pdf ${bytes.length} bytes`);
  });

  await test.step("5. Search finds the chat and the report", async () => {
    await page.locator("#rail-search").click();
    const field = page.locator("#search-field-input");
    await expect(field).toBeFocused();
    await field.pressSequentially(word, { delay: 40 });
    await expect(page.locator(`#search-hit-chat-${chatId}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(`#search-hit-report-${reportId}`)).toBeVisible();
  });

  saveMarker(baseURL as string, { word, chatId, reportId, reportTitle });
  console.log(`marker ${word} saved for the after-restart run`);
});

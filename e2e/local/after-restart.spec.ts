import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { lastReplyLength, readMarker, send, STUB_LABEL, waitForReplyDone } from "../support/localStack.ts";

test("after down and up: the chat, the report and the provider survive, and a new reply streams @after-restart", async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  const marker = readMarker(baseURL as string);
  console.log(`marker ${marker.word}: chat ${marker.chatId}, report ${marker.reportId}`);

  await test.step("1. The app opens straight to the rail; onboarding is remembered", async () => {
    await page.goto("/");
    await expect(page.locator("#rail")).toBeVisible();
    await expect(page.locator("#onboarding-step")).toHaveCount(0);
  });

  await test.step("2. Search still finds the chat and the report", async () => {
    await page.locator("#rail-search").click();
    await page.locator("#search-field-input").pressSequentially(marker.word, { delay: 40 });
    await expect(page.locator(`#search-hit-chat-${marker.chatId}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(`#search-hit-report-${marker.reportId}`)).toBeVisible();
  });

  await test.step("3. The report opens and its PDF downloads again", async () => {
    await page.goto("/reports");
    await expect(page.locator(`#reports-row-${marker.reportId}-title`)).toHaveText(marker.reportTitle);
    await page.locator(`#reports-row-${marker.reportId}-open`).click();
    await expect(page.locator("#report-detail-frame")).toHaveAttribute("src", new RegExp(`/api/artifacts/${marker.reportId}`));
    const download = page.waitForEvent("download");
    await page.locator("#report-detail-pdf").click();
    const bytes = await readFile((await (await download).path()) as string);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  });

  await test.step("4. The stub provider is still connected", async () => {
    await page.goto("/");
    await page.locator("#account-menu-button").click();
    await page.locator("#account-menu-models").click();
    await expect(page.locator("#provider-custom-label")).toHaveText(STUB_LABEL);
    await expect(page.locator("#provider-custom-status")).toContainText("Connected");
    await page.locator("#models-panel-close").click();
  });

  await test.step("5. The chat opens and a new reply completes with the stored key (the KEK decrypts it)", async () => {
    await page.goto(`/chats/${marker.chatId}`);
    const turns = page.locator("main [id$='-turns'] article:visible");
    await expect(turns.first()).toBeVisible();
    const before = await turns.count();
    await send(page, "Still there after the restart?");
    await expect(turns).toHaveCount(before + 1, { timeout: 30_000 });
    await waitForReplyDone(page);
    await expect(page.locator("[role=alert]")).toHaveCount(0);
    console.log(`new reply after restart: ${await lastReplyLength(page)} characters`);
  });
});

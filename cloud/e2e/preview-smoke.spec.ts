import { expect, type Page, test } from "@playwright/test";
import { completeOnboardingIfShown } from "../../e2e/support/onboarding";

const composer = (page: Page) => page.locator("main [id$='-composer-input']:visible");
const status = (page: Page) => page.locator("[id$='-header-status']:visible");
const stopButton = (page: Page) => page.locator("main [id$='-composer-stop']:visible");

async function lastReplyLength(page: Page): Promise<number> {
  const article = page.locator("main [id$='-turns'] article:visible").last();
  if ((await article.count()) === 0) return 0;
  const id = await article.getAttribute("id");
  const reply = page.locator(`[id="${id}-body"]`);
  if ((await reply.count()) === 0) return 0;
  return (await reply.innerText()).trim().length;
}

const LONG_PROMPT = "List eight facts about the ocean as a numbered list. Each item must be one full sentence of at least fifteen words.";
const POLL_MS = 75;

async function send(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

test("preview: onboarding, a streamed reply and stop @smoke", async ({ page }) => {
  await test.step("1. Onboarding", async () => {
    expect(await completeOnboardingIfShown(page)).toBe(true);
  });

  await test.step("2. A new chat starts a run", async () => {
    await page.locator("#sidebar-new-chat").click();
    await send(page, LONG_PROMPT);
    await expect(page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await expect(status(page)).toContainText("is working on this");
  });

  await test.step("3. The reply streams in and completes", async () => {
    const growth: number[] = [];
    const record = (length: number) => {
      if (length > (growth.at(-1) ?? 0)) growth.push(length);
    };
    const deadline = Date.now() + 180_000;
    while ((await status(page).count()) > 0) {
      if (Date.now() > deadline) throw new Error("the reply did not finish within 180 s");
      record(await lastReplyLength(page));
      await page.waitForTimeout(POLL_MS);
    }
    const final = await lastReplyLength(page);
    expect(final).toBeGreaterThan(0);
    record(final);
    console.log(`reply lengths seen while streaming: ${growth.join(", ")}`);
    expect(growth.length).toBeGreaterThanOrEqual(2);
    expect(growth[0]).toBeLessThan(final);
  });

  await test.step("4. Stop ends a running reply", async () => {
    const turns = page.locator("main [id$='-turns'] article:visible");
    const before = await turns.count();
    await send(page, "Write a 600-word essay about lighthouses.");
    await expect(status(page)).toContainText("is working on this");
    await expect(turns).toHaveCount(before + 1);
    await expect.poll(() => lastReplyLength(page), { timeout: 120_000, intervals: [POLL_MS] }).toBeGreaterThan(0);
    console.log(`stopping after ${await lastReplyLength(page)} characters`);
    await stopButton(page).click();
    await expect(status(page)).toBeHidden({ timeout: 15_000 });
    await expect(stopButton(page)).toHaveCount(0);
    const stoppedAt = await lastReplyLength(page);
    await page.waitForTimeout(2_000);
    expect(await lastReplyLength(page)).toBe(stoppedAt);
  });

  await test.step("5. Stop is not an error", async () => {
    const banner = page.locator("[id$='-error'][role=alert]");
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      expect(await banner.count()).toBe(0);
      await page.waitForTimeout(250);
    }
    expect(await lastReplyLength(page)).toBeGreaterThan(0);
  });
});

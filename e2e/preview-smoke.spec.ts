import { expect, type Page, test } from "@playwright/test";

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

async function send(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

test("preview: onboarding, a streamed reply and stop @smoke", async ({ page }) => {
  await test.step("1. Onboarding", async () => {
    await page.goto("/");
    await expect(page.locator("#onboarding-step")).toContainText("01 /");
    await page.locator("#agent-section-onboarding-name-input").fill("Sage");
    await page.locator("#agent-section-onboarding-look-ember").click();
    await page.locator("#agent-section-onboarding-tone-brief").click();
    await expect(page.locator("#agent-section-onboarding-title")).toHaveText("Hi, I'm Sage.");
    await page.locator("#onboarding-next").click();
    for (let i = 0; i < 6; i++) {
      const title = await page.locator("#onboarding-step").innerText();
      if (/model/i.test(title)) await page.getByRole("radio", { name: /DeepSeek V4 Flash/ }).click();
      if (/all set/i.test(title)) break;
      await page.locator("#onboarding-next").click();
    }
    await expect(page.locator("#onboarding-summary")).toContainText("Sage · brief · ember look");
    await page.locator("#onboarding-next").click();
    await expect(page.locator("#rail")).toBeVisible();
  });

  await test.step("2. A new chat starts a run", async () => {
    await page.locator("#sidebar-new-chat").click();
    await send(page, "Write four short sentences about the ocean.");
    await expect(page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await expect(status(page)).toContainText("is working on this");
  });

  await test.step("3. The reply streams in and completes", async () => {
    const lengths = new Set<number>();
    const deadline = Date.now() + 180_000;
    while ((await status(page).count()) > 0) {
      if (Date.now() > deadline) throw new Error("the reply did not finish within 180 s");
      const length = await lastReplyLength(page);
      if (length > 0) lengths.add(length);
      await page.waitForTimeout(250);
    }
    const final = await lastReplyLength(page);
    expect(final).toBeGreaterThan(0);
    lengths.add(final);
    console.log(`reply lengths seen while streaming: ${[...lengths].join(", ")}`);
    expect(lengths.size).toBeGreaterThanOrEqual(2);
  });

  await test.step("4. Stop ends a running reply", async () => {
    const turns = page.locator("main [id$='-turns'] article:visible");
    const before = await turns.count();
    await send(page, "Write a 600-word essay about lighthouses.");
    await expect(status(page)).toContainText("is working on this");
    await expect(turns).toHaveCount(before + 1);
    await expect.poll(() => lastReplyLength(page), { timeout: 120_000, intervals: [250] }).toBeGreaterThan(0);
    console.log(`stopping after ${await lastReplyLength(page)} characters`);
    await stopButton(page).click();
    await expect(status(page)).toBeHidden({ timeout: 15_000 });
    await expect(stopButton(page)).toHaveCount(0);
    const stoppedAt = await lastReplyLength(page);
    await page.waitForTimeout(2_000);
    expect(await lastReplyLength(page)).toBe(stoppedAt);
  });
});

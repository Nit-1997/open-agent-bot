import { expect, type Page, test } from "@playwright/test";
import { completeOnboardingIfShown } from "./support/onboarding";
import { BIG_SUR } from "./support/seed";
import { seeded } from "./support/state";

const PRIVATE_TARGET = "That address isn't reachable from the server.";
const PRIVATE_URLS: Array<[string, string]> = [
  ["ollama", "http://host.docker.internal:11434/v1"],
  ["custom", "http://127.0.0.1:8000/v1"],
  ["custom", "http://169.254.169.254/v1"],
];

const composer = (page: Page) => page.locator("main [id$='-composer-input']:visible");
const status = (page: Page) => page.locator("[id$='-header-status']:visible");

async function replyLength(page: Page): Promise<number> {
  const article = page.locator("main [id$='-turns'] article:visible").last();
  if ((await article.count()) === 0) return 0;
  const reply = page.locator(`[id="${await article.getAttribute("id")}-body"]`);
  if ((await reply.count()) === 0) return 0;
  return (await reply.innerText()).trim().length;
}

test("preview: isolation, provider settings, private URLs refused and admin guarded @m1", async ({ page }) => {
  const { otherChat } = seeded();

  await test.step("1. Onboarding", async () => {
    await completeOnboardingIfShown(page);
    await expect(page.locator("#rail")).toBeVisible();
  });

  await test.step("2. Isolation", async () => {
    const sidebar = page.locator("#chat-list-sidebar");
    await expect(sidebar).toContainText(BIG_SUR);
    await expect(sidebar).not.toContainText("Someone else's chat");
    await page.goto(`/chats/${otherChat}`);
    await expect(page.locator(`#chat-pane-${otherChat}-missing-title`)).toHaveText("This chat doesn't exist or isn't yours.");
    expect((await page.request.get(`/api/chats/${otherChat}/messages`)).status()).toBe(404);
  });

  await test.step("3. Provider settings", async () => {
    await page.goto("/");
    await expect(page.locator("#rail")).toBeVisible();
    await page.locator("#account-menu-button").click();
    await page.locator("#account-menu-models").click();
    await expect(page.locator("#models-panel")).toBeVisible();
    await expect(page.locator("#provider-openrouter-status")).not.toHaveText("Not connected");
    await expect(page.locator("#provider-litellm")).toHaveCount(0);
  });

  await test.step("4. Private URLs refused", async () => {
    for (const [id, url] of PRIVATE_URLS) {
      const row = `#provider-${id}`;
      if (!(await page.locator(`${row}-url`).isVisible())) await page.locator(`${row}-connect`).click();
      await page.locator(`${row}-url`).fill(url);
      await page.locator(`${row}-connect-save`).click();
      await expect(page.locator(`${row}-error`)).toHaveText(PRIVATE_TARGET);
      await expect(page.locator(`${row}-status`)).toHaveText("Not connected");
    }
  });

  await test.step("5. A model from settings works", async () => {
    await page.keyboard.press("Escape");
    await expect(page.locator("#models-panel")).toBeHidden();
    await page.locator("#sidebar-new-chat").click();
    await composer(page).fill("Reply with one short sentence about the sea.");
    await composer(page).press("Enter");
    await expect(page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await expect.poll(() => replyLength(page), { timeout: 180_000 }).toBeGreaterThan(0);
    await expect(status(page)).toBeHidden({ timeout: 180_000 });
  });

  await test.step("6. Admin guarded", async () => {
    await page.goto("/admin");
    await expect(page.locator("#shell-not-found-title")).toHaveText("This page doesn't exist.");
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.locator("[id^='admin-']")).toHaveCount(0);
  });
});

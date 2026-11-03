import { expect, type Page } from "@playwright/test";

export async function completeOnboardingIfShown(page: Page): Promise<boolean> {
  await page.goto("/");
  const step = page.locator("#onboarding-step");
  await expect(step.or(page.locator("#rail"))).toBeVisible();
  const shown = await step.isVisible();
  if (shown) {
    await expect(step).toContainText("01 /");
    await page.locator("#agent-section-onboarding-name-input").fill("Sage");
    await page.locator("#agent-section-onboarding-look-ember").click();
    await page.locator("#agent-section-onboarding-tone-brief").click();
    await expect(page.locator("#agent-section-onboarding-title")).toHaveText("Hi, I'm Sage.");
    await page.locator("#onboarding-next").click();
    for (let i = 0; i < 6; i++) {
      const title = await step.innerText();
      if (/model/i.test(title)) await page.getByRole("radio", { name: /DeepSeek V4 Flash/ }).click();
      if (/all set/i.test(title)) break;
      await page.locator("#onboarding-next").click();
    }
    await expect(page.locator("#onboarding-summary")).toContainText("Sage · brief · ember look");
    await page.locator("#onboarding-next").click();
  }
  await expect(page.locator("#rail")).toBeVisible();
  return shown;
}

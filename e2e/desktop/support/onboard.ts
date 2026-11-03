import { expect, type Page } from "@playwright/test";
import { connectStub } from "../../support/localStack";
import { STUB_MODEL } from "../../support/stubModel";

export async function onboardWithStub(page: Page, baseUrl: string): Promise<void> {
  await expect(page.locator("#onboarding-step")).toBeVisible({ timeout: 60_000 });
  for (let i = 0; i < 10; i++) {
    if (await page.locator("#onboarding-model-providers").isVisible()) {
      await connectStub(page, baseUrl);
      await expect(page.locator("#onboarding-model-list")).toBeVisible();
    }
    if (await page.locator("#onboarding-model-list").isVisible()) await page.getByRole("radio", { name: new RegExp(STUB_MODEL) }).click();
    if (await page.locator("#agent-section-onboarding-name-input").isVisible()) {
      await page.locator("#agent-section-onboarding-name-input").fill("Sage");
      await page.locator("#agent-section-onboarding-look-ember").click();
      await page.locator("#agent-section-onboarding-tone-brief").click();
    }
    if (await page.locator("#onboarding-summary").isVisible()) break;
    await page.locator("#onboarding-next").click();
  }
  await expect(page.locator("#onboarding-summary")).toContainText("Sage");
  await page.locator("#onboarding-next").click();
  await expect(page.locator("#rail")).toBeVisible();
}

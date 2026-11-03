import { expect, test } from "@playwright/test";
import { completeLocalOnboarding, stubBaseUrl } from "../support/localStack.ts";

const NOT_FOUND = "This page doesn't exist.";

test("local shell: no login, an account menu without sign-out or admin, and 404 pages", async ({ page }) => {
  await test.step("1. / opens the app with no login", async () => {
    const res = await page.goto("/");
    expect(res?.status()).toBe(200);
    await expect(page.locator("#onboarding-step").or(page.locator("#rail"))).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/");
    await completeLocalOnboarding(page, stubBaseUrl());
  });

  await test.step("2. The account menu has no sign-out and no admin", async () => {
    await page.locator("#account-menu-button").click();
    await expect(page.locator("#account-menu-list")).toBeVisible();
    await expect(page.locator("#account-menu-models")).toBeVisible();
    await expect(page.locator("#account-menu-signout")).toHaveCount(0);
    await expect(page.locator("[id^='account-menu-admin']")).toHaveCount(0);
    await expect(page.locator("#account-menu-list")).not.toContainText(/sign out|admin/i);
    await page.keyboard.press("Escape");
  });

  for (const path of ["/admin", "/nope"]) {
    await test.step(`3. ${path} answers 404`, async () => {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
      await expect(page.locator("#shell-not-found-title")).toHaveText(NOT_FOUND);
      await expect(page.locator("[id^='admin-']")).toHaveCount(0);
    });
  }
});

import { expect, type Page, test } from "@playwright/test";
import { completeOnboardingIfShown } from "../../e2e/support/onboarding";
import { admin } from "./support/admin";
import { BIG_SUR_REPORT } from "./support/seed";

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

test("old web against the new agent: chat, stop, artifact, request access @compat", async ({ page, request }) => {
  await test.step("1. Signed in (global setup) and onboarded", async () => {
    expect(await completeOnboardingIfShown(page)).toBe(true);
  });

  await test.step("2. A chat streams a reply through /api/copilotkit -> /agui", async () => {
    await page.locator("#sidebar-new-chat").click();
    await send(page, "Name three lighthouses on the US west coast, one sentence each.");
    await expect(page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await expect(status(page)).toContainText("is working on this");
    await expect(status(page)).toHaveCount(0, { timeout: 180_000 });
    const length = await lastReplyLength(page);
    console.log(`compat: reply of ${length} characters`);
    expect(length).toBeGreaterThan(0);
  });

  await test.step("3. Stop ends a running reply (the c1c0f4e web may show its pre-existing Stop banner)", async () => {
    await send(page, "Write a 600-word essay about lighthouses.");
    await expect(status(page)).toContainText("is working on this");
    await expect.poll(() => lastReplyLength(page), { timeout: 120_000, intervals: [100] }).toBeGreaterThan(0);
    await stopButton(page).click();
    await expect(status(page)).toBeHidden({ timeout: 15_000 });
    await expect(stopButton(page)).toHaveCount(0);
    const banner = await page.locator("[id$='-error'][role=alert]").count();
    console.log(`compat: stop ended the run; error banner shown: ${banner > 0 ? "yes (known c1c0f4e bug, fixed in M2)" : "no"}`);
  });

  await test.step("4. A seeded artifact opens through /api/artifacts -> /artifacts/:file (html and pdf)", async () => {
    const html = await request.get(`/api/artifacts/${BIG_SUR_REPORT.id}`);
    expect(html.status()).toBe(200);
    expect(html.headers()["content-type"]).toMatch(/^text\/html/);
    expect(await html.text()).toContain(BIG_SUR_REPORT.title);
    const pdf = await request.get(`/api/artifacts/${BIG_SUR_REPORT.id}?format=pdf`, { timeout: 120_000 });
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    console.log("compat: artifact html 200, pdf 200");
  });

  await test.step("5. Request access reaches the new agent's /access-requests", async () => {
    const email = `oab-e2e+compat-${Date.now()}@example.test`;
    const context = await page.context().browser()?.newContext({ ignoreHTTPSErrors: true, baseURL: test.info().project.use.baseURL });
    if (!context) throw new Error("no browser for the signed-out context");
    const anon = await context.newPage();
    await anon.goto("/request-access");
    await anon.locator("#request-access-name").fill("Compat Check");
    await anon.locator("#request-access-email").fill(email);
    await anon.locator("#request-access-note").fill("M6 old web against the new agent");
    await anon.waitForTimeout(3_500);
    await anon.locator("#request-access-submit").click();
    await expect(anon.locator("#request-access-thanks")).toBeVisible({ timeout: 30_000 });
    await context.close();
    await expect
      .poll(
        async () => {
          const { data, error } = await admin().from("access_requests").select("email").eq("email", email);
          if (error) throw new Error(`access_requests lookup: ${error.message}`);
          return data.length;
        },
        { timeout: 30_000 },
      )
      .toBe(1);
    console.log("compat: access request stored by the new agent");
  });
});

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { STUB_API_KEY, STUB_DEFAULT_PORT, STUB_MODEL } from "./stubModel.ts";

type Env = Readonly<Record<string, string | undefined>>;

export const STUB_LABEL = "Stub model";
export const LOCAL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../.local");

export function stubBaseUrl(env: Env = process.env): string {
  const host = env.STUB_HOST?.trim() || "host.docker.internal";
  const port = env.STUB_PORT?.trim() || String(STUB_DEFAULT_PORT);
  return `http://${host}:${port}/v1`;
}

export const composer = (page: Page) => page.locator("main [id$='-composer-input']:visible");
export const status = (page: Page) => page.locator("[id$='-header-status']:visible");
export const stopButton = (page: Page) => page.locator("main [id$='-composer-stop']:visible");
export const alerts = (page: Page) => page.locator("[role=alert]");

export async function lastReplyLength(page: Page): Promise<number> {
  const article = page.locator("main [id$='-turns'] article:visible").last();
  if ((await article.count()) === 0) return 0;
  const reply = page.locator(`[id="${await article.getAttribute("id")}-body"]`);
  if ((await reply.count()) === 0) return 0;
  return (await reply.innerText()).trim().length;
}

export async function send(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}

export async function noAlertFor(page: Page, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    expect(await alerts(page).count()).toBe(0);
    await page.waitForTimeout(250);
  }
}

export async function connectStub(page: Page, baseUrl: string): Promise<void> {
  await page.locator("#provider-custom-connect").click();
  await page.locator("#provider-custom-url").fill(baseUrl);
  await page.locator("#provider-custom-name").fill(STUB_LABEL);
  await page.locator("#provider-custom-server-key").fill(STUB_API_KEY);
  await page.locator("#provider-custom-connect-save").click();
  await expect(page.locator("#provider-custom-error")).toHaveCount(0);
}

export async function completeLocalOnboarding(page: Page, baseUrl: string): Promise<boolean> {
  await page.goto("/");
  const step = page.locator("#onboarding-step");
  await expect(step.or(page.locator("#rail"))).toBeVisible();
  if (!(await step.isVisible())) return false;
  await expect(step).toContainText("01 /");
  for (let i = 0; i < 10; i++) {
    if (await page.locator("#onboarding-model-providers").isVisible()) {
      await connectStub(page, baseUrl);
      await expect(page.locator("#onboarding-model-list")).toBeVisible();
    }
    if (await page.locator("#onboarding-model-list").isVisible()) {
      await page.getByRole("radio", { name: new RegExp(STUB_MODEL) }).click();
    }
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
  return true;
}

export type Marker = { word: string; chatId: string; reportId: string; reportTitle: string };

const markerPath = (origin: string, name: string) => resolve(LOCAL_DIR, `${name}-${new URL(origin).port}.json`);

export function saveMarker(origin: string, marker: Marker, name = "marker"): void {
  mkdirSync(LOCAL_DIR, { recursive: true });
  writeFileSync(markerPath(origin, name), `${JSON.stringify(marker)}\n`);
}

export function readMarker(origin: string, name = "marker"): Marker {
  return JSON.parse(readFileSync(markerPath(origin, name), "utf8")) as Marker;
}

export async function waitForReplyDone(page: Page, timeout = 120_000): Promise<void> {
  await expect(status(page)).toBeHidden({ timeout });
  await expect.poll(() => lastReplyLength(page), { timeout: 30_000 }).toBeGreaterThan(0);
}

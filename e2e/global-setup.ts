import { mkdirSync } from "node:fs";
import { chromium, type FullConfig, request } from "@playwright/test";
import { AUTH_DIR, env } from "./support/env";
import { seed } from "./support/seed";
import { saveSeeded } from "./support/state";
import { cleanupE2e, createUser, DEMO_USER, OTHER_USER, signIn } from "./support/users";

async function saveModelKey(storageState: string, origin: string): Promise<void> {
  const apiKey = env("E2E_OPENROUTER_KEY");
  const ctx = await request.newContext({ baseURL: origin, ignoreHTTPSErrors: true, storageState });
  const res = await ctx.post("/api/providers/openrouter/key", { data: { apiKey }, headers: { origin } });
  await ctx.dispose();
  if (!res.ok()) throw new Error(`saving the OpenRouter key failed with HTTP ${res.status()}`);
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  mkdirSync(AUTH_DIR, { recursive: true });
  cleanupE2e();
  createUser(DEMO_USER);
  createUser(OTHER_USER);
  saveSeeded(await seed(DEMO_USER, OTHER_USER));
  const browser = await chromium.launch();
  try {
    const demo = await signIn(browser, DEMO_USER);
    await signIn(browser, OTHER_USER);
    await saveModelKey(demo, env("APP_ORIGIN"));
  } finally {
    await browser.close();
  }
}

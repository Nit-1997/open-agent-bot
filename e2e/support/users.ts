import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { Browser } from "@playwright/test";
import { AUTH_DIR, env, ROOT, scriptEnv } from "./env";

export const DEMO_USER = "oab-e2e+shell@example.test";
export const OTHER_USER = "oab-e2e+other@example.test";

const script = (name: string, args: string[]) =>
  execFileSync("node", [resolve(ROOT, "supabase/scripts", name), ...args], { env: scriptEnv(), encoding: "utf8" });

export const storageFor = (email: string) => resolve(AUTH_DIR, `${email.replace(/[^a-z0-9]/gi, "_")}.json`);

export function createUser(email: string): void {
  script("bootstrap-admin.mjs", ["--user", email]);
}

export function cleanupE2e(): void {
  script("cleanup-e2e.mjs", []);
}

export function signInLink(email: string): string {
  const link = script("dev-link.mjs", [email]).trim().split("\n").at(-1) ?? "";
  if (!link.startsWith(`${env("APP_ORIGIN")}/auth/confirm?`)) throw new Error("dev-link printed no sign-in link");
  return link;
}

export async function signIn(browser: Browser, email: string): Promise<string> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(signInLink(email));
  await page.locator("#auth-confirm-continue").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"));
  const path = storageFor(email);
  await context.storageState({ path });
  await context.close();
  return path;
}

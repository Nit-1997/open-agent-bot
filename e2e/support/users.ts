import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { Browser } from "@playwright/test";
import { isTestEmail } from "../../supabase/scripts/test-users.mjs";
import { admin } from "./admin";
import { AUTH_DIR, env, ROOT, scriptEnv } from "./env";

export const DEMO_USER = "oab-e2e+shell@example.test";
export const OTHER_USER = "oab-e2e+other@example.test";

const script = (name: string, args: string[]) =>
  execFileSync("node", [resolve(ROOT, "supabase/scripts", name), ...args], { env: scriptEnv(), encoding: "utf8" });

export const storageFor = (email: string) => resolve(AUTH_DIR, `${email.replace(/[^a-z0-9]/gi, "_")}.json`);

export async function assertNotAdmin(email: string): Promise<void> {
  const db = admin();
  const { data: rows, error } = await db.from("profiles").select("user_id").eq("email", email);
  if (error) throw new Error(`role check for ${email}: ${error.message}`);
  const id = (rows as Array<{ user_id: string }>)[0]?.user_id;
  if (!id) throw new Error(`role check for ${email}: no profile`);
  const { data, error: userError } = await db.auth.admin.getUserById(id);
  if (userError) throw new Error(`role check for ${email}: ${userError.message}`);
  const role = data.user.app_metadata?.role;
  if (role === "admin") throw new Error(`${email} is an admin; e2e users must be plain users`);
  console.log(`role check: ${email} is not admin (role ${role ?? "none"})`);
}

export async function createUser(email: string): Promise<void> {
  if (!isTestEmail(email)) throw new Error(`refusing to create non-test user ${email}`);
  script("bootstrap-admin.mjs", ["--user", email]);
  await assertNotAdmin(email);
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

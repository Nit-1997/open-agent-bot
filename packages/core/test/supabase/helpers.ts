import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readEnvFile } from "../../evals/auth.js";
import { createAuthAdmin } from "../../src/admin/authAdmin.js";
import { deleteAccount } from "../../src/admin/deleteAccount.js";
import { createAdminRepo } from "../../src/db/admin.js";
import { createAnonClient, createServiceClient } from "../../src/db/client.js";

const ROOT = resolve(new URL(".", import.meta.url).pathname, "../../..");

export const env: Record<string, string> = {
  ...readEnvFile(resolve(ROOT, "deploy-config/.env-agent")),
  ...readEnvFile(resolve(ROOT, "deploy-config/env-files/.env-supabase-admin")),
};

export const enabled = process.env.SUPABASE_INTEGRATION === "1";

const AUTH = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;

export const cfg = () => ({
  supabaseUrl: env.SUPABASE_URL,
  supabaseSecretKey: env.SUPABASE_SECRET_KEY,
  supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY,
});

export const service = () => createServiceClient(cfg());
export const anon = () => createAnonClient(cfg());
export const adminRepo = () => createAdminRepo(service());
export function appOrigin(): string {
  if (!env.APP_ORIGIN) throw new Error("APP_ORIGIN is missing from deploy-config/.env-agent");
  return env.APP_ORIGIN;
}

export const authAdmin = () => createAuthAdmin({ service: service(), anon: anon(), appOrigin: appOrigin() });

export const testEmail = () => `oab-test+${randomUUID()}@example.test`;

export type TestUser = { id: string; email: string; accessToken: string; client: SupabaseClient };

const created: Array<{ id: string; email: string }> = [];

export async function sessionFor(email: string): Promise<{ accessToken: string; client: SupabaseClient }> {
  const link = await service().auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw link.error;
  const verifier = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, { auth: AUTH });
  const { data, error } = await verifier.auth.verifyOtp({ type: "email", token_hash: link.data.properties.hashed_token });
  if (error || !data.session) throw error ?? new Error("no session");
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: AUTH,
    global: { headers: { authorization: `Bearer ${data.session.access_token}` } },
  });
  return { accessToken: data.session.access_token, client };
}

export async function createBareUser(): Promise<{ id: string; email: string }> {
  const email = testEmail();
  await adminRepo().invited.add(email, null, null);
  const { data, error } = await service().auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("no user");
  created.push({ id: data.user.id, email });
  return { id: data.user.id, email };
}

export async function createTestUser(): Promise<TestUser> {
  const user = await createBareUser();
  return { ...user, ...(await sessionFor(user.email)) };
}

export async function deleteUser(id: string, email: string): Promise<void> {
  await deleteAccount({ repo: adminRepo(), auth: authAdmin() }, { id, email });
}

export function track(id: string, email: string): void {
  created.push({ id, email });
}

export async function deleteCreatedUsers(): Promise<string[]> {
  const gone = created.splice(0);
  for (const u of gone) await deleteUser(u.id, u.email);
  return gone.map((u) => u.email);
}

export async function remainingRows(emails: string[]): Promise<number> {
  if (!emails.length) return 0;
  const db = service();
  let total = 0;
  for (const table of ["profiles", "access_requests", "invited_emails"]) {
    const { count, error } = await db.from(table).select("*", { count: "exact", head: true }).in("email", emails);
    if (error) throw error;
    total += count ?? 0;
  }
  return total;
}

export async function managementQuery<T>(query: string): Promise<T[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query/read-only`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`management query failed: ${res.status}`);
  return (await res.json()) as T[];
}

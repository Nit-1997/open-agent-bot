import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readEnvFile } from "../../evals/auth.js";
import { createAuthAdmin } from "../../src/hosted/admin/authAdmin.js";
import { deleteAccount } from "../../src/hosted/admin/deleteAccount.js";
import { createAdminRepo } from "../../src/hosted/store/admin.js";
import { createAnonClient, createServiceClient } from "../../src/hosted/store/client.js";

const ROOT = resolve(new URL(".", import.meta.url).pathname, "../../../..");

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

export type CleanupFailure = { email: string; error: { code: string; message: string } };
export type CleanupReport = { deleted: string[]; failed: CleanupFailure[] };
type CleanupOptions = { remove?: (id: string, email: string) => Promise<void>; retries?: number; backoffMs?: number };

const SECRET_LIKE = /eyJ[\w-]+\.[\w-]+\.[\w-]*|sb_(?:secret|publishable)_[\w-]+|bearer\s+\S+/gi;

function reduceError(e: unknown): CleanupFailure["error"] {
  const raw = e as { code?: unknown; status?: unknown; message?: unknown };
  const code = typeof raw?.code === "string" ? raw.code : raw?.status !== undefined ? String(raw.status) : "unknown";
  const message = (typeof raw?.message === "string" ? raw.message : String(e)).replace(SECRET_LIKE, "[redacted]").slice(0, 300);
  return { code, message };
}

async function deleteWithRetry(user: { id: string; email: string }, opts: Required<CleanupOptions>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await opts.remove(user.id, user.email);
    } catch (e) {
      const error = reduceError(e);
      console.warn(`[supabase cleanup] ${user.email} attempt ${attempt} failed: ${error.code} ${error.message}`);
      if (attempt > opts.retries) throw Object.assign(new Error(error.message), { reduced: error });
      await new Promise((r) => setTimeout(r, opts.backoffMs));
    }
  }
}

export async function deleteCreatedUsers(options: CleanupOptions = {}): Promise<CleanupReport> {
  const opts = { remove: deleteUser, retries: 3, backoffMs: 1000, ...options };
  const gone = created.splice(0);
  const results = await Promise.allSettled(gone.map((u) => deleteWithRetry(u, opts)));
  const report: CleanupReport = { deleted: [], failed: [] };
  results.forEach((r, i) => {
    const email = gone[i]!.email;
    if (r.status === "fulfilled") report.deleted.push(email);
    else report.failed.push({ email, error: (r.reason as { reduced: CleanupFailure["error"] }).reduced });
  });
  return report;
}

export const cleanedEmails = (report: CleanupReport): string[] => [...report.deleted, ...report.failed.map((f) => f.email)];

export async function remainingRows(emails: string[]): Promise<number> {
  if (!emails.length) return 0;
  const db = service();
  let total = 0;
  for (const table of ["profiles", "access_requests", "invited_emails"] as const) {
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

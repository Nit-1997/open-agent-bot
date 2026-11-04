import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";

export const REFUSAL = "local_stack_only";
export const LIVE_ENV = ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF", "SUPABASE_DB_URL", "LIVE_DB_URL"] as const;
export const STACK_ENV = ["OAB_SB_API_URL", "OAB_SB_DB_URL", "OAB_SB_PUBLISHABLE_KEY", "OAB_SB_SECRET_KEY", "OAB_SB_MAIL_URL"] as const;
export const PORT_MIN = 18700;
export const PORT_MAX = 18749;

export class HarnessRefusal extends Error {
  readonly code = REFUSAL;
  constructor(message: string) {
    super(`${REFUSAL}: ${message}`);
    this.name = "HarnessRefusal";
  }
}

export type LocalStackEnv = { apiUrl: string; dbUrl: string; publishableKey: string; secretKey: string; mailUrl: string };

const inRange = (port: string) => /^\d+$/.test(port) && Number(port) >= PORT_MIN && Number(port) <= PORT_MAX;
const LOOPBACK_HTTP = /^http:\/\/127\.0\.0\.1:(\d+)$/;

function loopbackHttp(name: string, raw: string): string {
  const m = LOOPBACK_HTTP.exec(raw);
  if (!m || !inRange(m[1])) throw new HarnessRefusal(`${name} must be http://127.0.0.1:<${PORT_MIN}-${PORT_MAX}> (no path)`);
  return raw;
}

function loopbackDb(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HarnessRefusal("OAB_SB_DB_URL is not a URL");
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new HarnessRefusal("OAB_SB_DB_URL must be a postgresql:// URL");
  if (u.hostname !== "127.0.0.1") throw new HarnessRefusal(`OAB_SB_DB_URL host must be 127.0.0.1 (got ${u.hostname || "none"})`);
  if (!inRange(u.port)) throw new HarnessRefusal(`OAB_SB_DB_URL port must be ${PORT_MIN}-${PORT_MAX} (got ${u.port || "default"})`);
  return raw;
}

export function guardLocalEnv(env: NodeJS.ProcessEnv): LocalStackEnv | undefined {
  const live = LIVE_ENV.filter((k) => env[k] !== undefined && env[k] !== "");
  if (live.length) throw new HarnessRefusal(`refusing to run with ${live.join(", ")} set: the local suite never talks to a live project`);
  const present = STACK_ENV.filter((k) => env[k]);
  if (present.length === 0) return undefined;
  const missing = STACK_ENV.filter((k) => !env[k]);
  if (missing.length)
    throw new HarnessRefusal(
      `incomplete local stack env: ${missing.join(", ")} missing (eval "$(node cloud/supabase/scripts/local-stack.mjs env --name <x>)")`,
    );
  const publishableKey = env.OAB_SB_PUBLISHABLE_KEY!;
  const secretKey = env.OAB_SB_SECRET_KEY!;
  if (!publishableKey.startsWith("sb_publishable_")) throw new HarnessRefusal("OAB_SB_PUBLISHABLE_KEY must start with sb_publishable_");
  if (!secretKey.startsWith("sb_secret_")) throw new HarnessRefusal("OAB_SB_SECRET_KEY must start with sb_secret_");
  return {
    apiUrl: loopbackHttp("OAB_SB_API_URL", env.OAB_SB_API_URL!),
    dbUrl: loopbackDb(env.OAB_SB_DB_URL!),
    publishableKey,
    secretKey,
    mailUrl: loopbackHttp("OAB_SB_MAIL_URL", env.OAB_SB_MAIL_URL!),
  };
}

export function localEnv(env: NodeJS.ProcessEnv = process.env): LocalStackEnv {
  const stack = guardLocalEnv(env);
  if (!stack) throw new HarnessRefusal("no local stack env (OAB_SB_*) is set");
  return stack;
}

const AUTH = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } as const;

export const admin = (): SupabaseClient => createClient(localEnv().apiUrl, localEnv().secretKey, { auth: AUTH });
export const anon = (): SupabaseClient => createClient(localEnv().apiUrl, localEnv().publishableKey, { auth: AUTH });

let pool: pg.Pool | undefined;

export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  pool ??= new pg.Pool({ connectionString: localEnv().dbUrl, max: 4 });
  return (await pool.query<T>(text, params)).rows;
}

export const testEmail = (tag = "user") => `oab-m7+${tag}-${randomUUID().slice(0, 8)}@example.test`;

const tracked = new Set<string>();

export function track(email: string): string {
  if (!/^oab-m7\+[a-z0-9-]+@example\.test$/.test(email)) throw new Error(`refusing to track a non-test email: ${email}`);
  tracked.add(email);
  return email;
}

export async function invite(email: string): Promise<void> {
  await sql("insert into public.invited_emails (email) values ($1) on conflict do nothing", [track(email)]);
}

export type LocalUser = { id: string; email: string };

export async function createUser(opts: { email?: string; invited?: boolean; password?: string } = {}): Promise<LocalUser> {
  const email = track(opts.email ?? testEmail());
  if (opts.invited ?? true) await invite(email);
  const { data, error } = await admin().auth.admin.createUser({
    email,
    email_confirm: true,
    ...(opts.password && { password: opts.password }),
  });
  if (error || !data.user) throw error ?? new Error("createUser returned no user");
  return { id: data.user.id, email };
}

export type Session = { accessToken: string; refreshToken: string; client: SupabaseClient };

export async function signIn(user: Pick<LocalUser, "email">): Promise<Session> {
  const link = await admin().auth.admin.generateLink({ type: "magiclink", email: user.email });
  if (link.error) throw link.error;
  const { data, error } = await anon().auth.verifyOtp({ type: "email", token_hash: link.data.properties.hashed_token });
  if (error || !data.session) throw error ?? new Error("verifyOtp returned no session");
  const client = createClient(localEnv().apiUrl, localEnv().publishableKey, {
    auth: AUTH,
    global: { headers: { authorization: `Bearer ${data.session.access_token}` } },
  });
  return { accessToken: data.session.access_token, refreshToken: data.session.refresh_token, client };
}

export async function cleanup(): Promise<number> {
  const emails = [...tracked];
  tracked.clear();
  if (emails.length) {
    const users = await sql<{ id: string }>("select id from auth.users where email = any($1::text[])", [emails]);
    for (const { id } of users) {
      const { error } = await admin().auth.admin.deleteUser(id);
      if (error) throw error;
    }
    await sql("delete from public.invited_emails where email = any($1::text[])", [emails]);
  }
  const [{ left }] = await sql<{ left: number }>(
    "select (select count(*) from auth.users where email = any($1::text[])) + (select count(*) from public.invited_emails where email = any($1::text[]))::int as left",
    [emails],
  );
  return Number(left);
}

export async function closeHarness(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

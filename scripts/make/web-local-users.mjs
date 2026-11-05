#!/usr/bin/env node
import { createRequire } from "node:module";

const req = createRequire(new URL("../../cloud/agent/package.json", import.meta.url));

export const APP = "http://localhost:18721";
export const USERS = Object.freeze({ "owner@local.test": "admin", "member@local.test": "member" });
export const MODES = Object.freeze(["invite", "waitlist", "open"]);
const LOCAL_API = /^http:\/\/127\.0\.0\.1:187[0-4]\d$/;

function localOnly(env) {
  let db;
  try {
    db = new URL(env.OAB_SB_DB_URL ?? "");
  } catch {
    db = undefined;
  }
  const port = Number(db?.port);
  if (
    !LOCAL_API.test(env.OAB_SB_API_URL ?? "") ||
    db?.hostname !== "127.0.0.1" ||
    !(port >= 18700 && port <= 18749) ||
    !env.OAB_SB_SECRET_KEY
  ) {
    console.error("local_stack_only: web-local-users.mjs talks only to the local stack on 127.0.0.1:18700-18749");
    process.exit(2);
  }
  return { api: env.OAB_SB_API_URL, db: db.href, secret: env.OAB_SB_SECRET_KEY };
}

function known(email) {
  if (!Object.hasOwn(USERS, email)) throw new Error(`not a web-local user: ${email} (one of ${Object.keys(USERS).join(", ")})`);
  return email;
}

async function main(argv) {
  const { api, db, secret } = localOnly(process.env);
  const { createClient } = req("@supabase/supabase-js");
  const pg = req("pg");
  const admin = createClient(api, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const sql = async (text, params = []) => {
    const c = new pg.Client({ connectionString: db });
    await c.connect();
    try {
      return (await c.query(text, params)).rows;
    } finally {
      await c.end();
    }
  };

  const create = async (email) => {
    const role = USERS[known(email)];
    await sql("insert into public.invited_emails (email) values ($1) on conflict do nothing", [email]);
    const [found] = await sql("select id from auth.users where email = $1", [email]);
    if (found) return `${email} exists (${role})`;
    const { error } = await admin.auth.admin.createUser({ email, email_confirm: true, app_metadata: role === "admin" ? { role } : {} });
    if (error) throw error;
    return `${email} created (${role}, no human check yet)`;
  };

  const onboarded = async (email) => {
    const rows = await sql(
      `update public.profiles set data = data || '{"name":"Member","onboardedAt":"2026-11-04T00:00:00Z"}'::jsonb where email = $1 returning user_id`,
      [known(email)],
    );
    if (rows.length !== 1) throw new Error(`no profile for ${email}`);
    return `${email} skips onboarding`;
  };

  const link = async (email) => {
    const { data, error } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: known(email),
      options: { redirectTo: `${APP}/auth/confirm` },
    });
    if (error) throw error;
    return `${APP}/auth/confirm?token_hash=${data.properties.hashed_token}&type=email&email=${encodeURIComponent(email)}`;
  };

  const mode = async (m) => {
    if (m !== undefined && !MODES.includes(m)) throw new Error(`mode must be one of ${MODES.join(", ")}`);
    const rows =
      m === undefined
        ? await sql("select mode from public.signup_settings where id")
        : await sql("update public.signup_settings set mode = $1, updated_at = now() where id returning mode", [m]);
    if (rows.length !== 1) throw new Error("public.signup_settings has no row");
    return rows[0].mode;
  };

  const [cmd, arg] = argv;
  const commands = { create, onboarded, link, mode };
  if (!Object.hasOwn(commands, cmd)) throw new Error(`usage: web-local-users.mjs <${Object.keys(commands).join("|")}> [arg]`);
  return commands[cmd](arg);
}

main(process.argv.slice(2)).then(
  (out) => console.log(out),
  (err) => {
    console.error(`web-local-users: ${err?.message ?? err}`);
    process.exit(1);
  },
);

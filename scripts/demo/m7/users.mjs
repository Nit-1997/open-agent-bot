import { createRequire } from "node:module";

const req = createRequire(new URL("../../../cloud/agent/package.json", import.meta.url));
const { createClient } = req("@supabase/supabase-js");
const pg = req("pg");

const APP = "http://localhost:18721";
const LOCAL = /^http:\/\/127\.0\.0\.1:187[0-4]\d$/;
const EMAIL = /^oab-m7\+demo-[a-z0-9-]{1,40}@example\.test$/;

function localOnly(env) {
  const api = env.OAB_SB_API_URL ?? "";
  let db;
  try {
    db = new URL(env.OAB_SB_DB_URL ?? "");
  } catch {
    db = undefined;
  }
  const port = Number(db?.port);
  if (!LOCAL.test(api) || db?.hostname !== "127.0.0.1" || !(port >= 18700 && port <= 18749) || !env.OAB_SB_SECRET_KEY) {
    console.error("local_stack_only: users.mjs talks only to the oab-m7 local stack on 127.0.0.1:18700-18749");
    process.exit(2);
  }
  return { api, db: db.href };
}

const { api, db } = localOnly(process.env);
const admin = createClient(api, process.env.OAB_SB_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const emailOf = (tag) => {
  const email = tag.includes("@") ? tag : `oab-m7+demo-${tag}@example.test`;
  if (!EMAIL.test(email)) throw new Error(`not a demo email: ${email}`);
  return email;
};

async function sql(text, params = []) {
  const c = new pg.Client({ connectionString: db });
  await c.connect();
  try {
    return (await c.query(text, params)).rows;
  } finally {
    await c.end();
  }
}

const idOf = async (email) => (await sql("select id from auth.users where email = $1", [email]))[0]?.id;

async function create(tag, role) {
  const email = emailOf(tag);
  await sql("insert into public.invited_emails (email) values ($1) on conflict do nothing", [email]);
  const found = await idOf(email);
  if (found) return found;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, app_metadata: role === "admin" ? { role } : {} });
  if (error) throw error;
  return data.user.id;
}

async function link(tag) {
  const email = emailOf(tag);
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo: `${APP}/auth/confirm` } });
  if (error) throw error;
  return `${APP}/auth/confirm?token_hash=${data.properties.hashed_token}&type=email&email=${encodeURIComponent(email)}`;
}

async function onboarded(tag) {
  const rows = await sql(
    `update public.profiles set data = data || '{"name":"Demo","onboardedAt":"2026-11-04T00:00:00Z"}'::jsonb where email = $1 returning user_id`,
    [emailOf(tag)],
  );
  return rows.length;
}

async function setRole(tag, role) {
  const sqlRole = role === "admin" ? `jsonb_set(raw_app_meta_data, '{role}', '"admin"')` : "raw_app_meta_data - 'role'";
  const rows = await sql(`update auth.users set raw_app_meta_data = ${sqlRole} where email = $1 returning id`, [emailOf(tag)]);
  return rows.length;
}

async function seed(n) {
  const out = [];
  for (let k = 1; k <= n; k++) {
    const tag = `seed${String(k).padStart(2, "0")}`;
    const id = await create(tag);
    for (let i = 0; i < k; i++)
      await sql("select ok from public.request_admit($1, 1000, 1000, now() - make_interval(mins => $2))", [id, (n - k) * 10 + (k - i)]);
    out.push(`${emailOf(tag)} ${k}`);
  }
  return out.join("\n");
}

async function counts(tag) {
  const id = await idOf(emailOf(tag));
  if (!id) return "no such user";
  const [u] = await sql(
    "select coalesce(sum(count), 0)::int as month, (select count(*)::int from public.human_checks where user_id = $1) as checks from public.request_usage where user_id = $1",
    [id],
  );
  return `${emailOf(tag)}: ${u.month} counted this month, ${u.checks} human check`;
}

async function cleanup() {
  const rows = await sql("select id from auth.users where email like 'oab-m7+demo-%@example.test'");
  for (const { id } of rows) await admin.auth.admin.deleteUser(id);
  await sql("delete from public.invited_emails where email like 'oab-m7+demo-%@example.test'");
  return `deleted ${rows.length} demo users`;
}

const [cmd, ...args] = process.argv.slice(2);
const commands = {
  create: () => create(args[0], args[1]),
  link: () => link(args[0]),
  id: async () => (await idOf(emailOf(args[0]))) ?? "",
  delete: async () => {
    const id = await idOf(emailOf(args[0]));
    if (id) await admin.auth.admin.deleteUser(id);
    return id ? `deleted ${emailOf(args[0])}` : `no ${emailOf(args[0])}`;
  },
  onboarded: () => onboarded(args[0]),
  promote: () => setRole(args[0], "admin"),
  demote: () => setRole(args[0], "member"),
  seed: () => seed(Number(args[0])),
  counts: () => counts(args[0]),
  sql: async () => JSON.stringify(await sql(args[0])),
  cleanup,
};
if (!commands[cmd]) {
  console.error(`usage: users.mjs <${Object.keys(commands).join("|")}> …`);
  process.exit(2);
}
try {
  console.log(await commands[cmd]());
} catch (err) {
  console.error(`users.mjs ${cmd} failed: ${err?.message ?? err}`);
  process.exit(1);
}

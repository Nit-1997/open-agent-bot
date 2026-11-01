#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const API = "https://api.supabase.com/v1";
const SECRET_FIELDS = new Set(["smtp_pass", "external_google_secret"]);
const PRO_ONLY = ["sessions_timebox", "sessions_inactivity_timeout"];
const HOOK_FN = "private.before_user_created(jsonb)";

const args = new Set(process.argv.slice(2));
const mode = args.has("--apply") ? "apply" : args.has("--check") ? "check" : undefined;
if (!mode) fail("usage: configure-auth.mjs --check | --apply [--rotate-secrets] [--disable-legacy-keys]");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function env(name, { optional = false } = {}) {
  const v = process.env[name]?.trim();
  if (!v && !optional) fail(`missing ${name} (load deploy-config/env-files/.env-supabase-admin)`);
  return v ?? "";
}

const ref = env("SUPABASE_PROJECT_REF");
const token = env("SUPABASE_ACCESS_TOKEN");
const template = (name) => readFileSync(join(HERE, "..", "templates", name), "utf8");

function allowList() {
  const origins = ["https://app.localhost", env("PROD_ORIGIN", { optional: true })].filter(Boolean);
  return origins.flatMap((o) => [`${o}/auth/callback`, `${o}/auth/confirm`]).join(",");
}

function desired() {
  return {
    site_url: env("SITE_URL"),
    uri_allow_list: allowList(),
    disable_signup: true,
    external_email_enabled: true,
    mailer_autoconfirm: false,
    mailer_allow_unverified_email_sign_ins: false,
    external_anonymous_users_enabled: false,
    external_phone_enabled: false,
    external_google_enabled: true,
    external_google_client_id: env("GOOGLE_CLIENT_ID"),
    external_google_secret: env("GOOGLE_CLIENT_SECRET"),
    external_google_email_optional: false,
    security_manual_linking_enabled: false,
    mailer_notifications_identity_linked_enabled: true,
    mailer_notifications_identity_unlinked_enabled: true,
    jwt_exp: 900,
    refresh_token_rotation_enabled: true,
    security_refresh_token_reuse_interval: 10,
    sessions_timebox: 720,
    sessions_inactivity_timeout: 168,
    mailer_otp_exp: 3600,
    rate_limit_email_sent: 30,
    smtp_host: "smtp.resend.com",
    smtp_port: "465",
    smtp_user: "resend",
    smtp_pass: env("RESEND_API_KEY"),
    smtp_admin_email: env("SMTP_SENDER_EMAIL"),
    smtp_sender_name: "Open Agent",
    smtp_max_frequency: 60,
    mailer_subjects_invite: "You're invited to Open Agent",
    mailer_templates_invite_content: template("invite.html"),
    mailer_subjects_magic_link: "Your Open Agent sign-in link",
    mailer_templates_magic_link_content: template("magic_link.html"),
    hook_before_user_created_enabled: true,
    hook_before_user_created_uri: "pg-functions://postgres/private/before_user_created",
    security_captcha_enabled: false,
    password_min_length: 12,
  };
}

async function api(method, path, body) {
  const res = await fetch(`${API}/projects/${ref}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

const show = (field, value) => (SECRET_FIELDS.has(field) ? (value == null ? "<unset>" : "<set>") : JSON.stringify(value)?.slice(0, 80));

function diff(current, want, rotate) {
  const changes = {};
  for (const [field, value] of Object.entries(want)) {
    const now = current[field];
    const differs = SECRET_FIELDS.has(field) ? now == null || rotate : now !== value;
    if (differs) changes[field] = value;
  }
  return changes;
}

async function hookFunctionExists() {
  const rows = await api("POST", "/database/query/read-only", {
    query: `select to_regprocedure('${HOOK_FN}') is not null as ok`,
  });
  return rows?.[0]?.ok === true;
}

async function checkSigningKeys() {
  const res = await api("GET", "/config/auth/signing-keys");
  const keys = Array.isArray(res) ? res : (res?.keys ?? []);
  const inUse = keys.filter((k) => k.status === "in_use");
  if (inUse.length !== 1 || inUse[0].algorithm !== "ES256") fail(`signing keys: expected one in_use ES256 key, found ${JSON.stringify(inUse.map((k) => k.algorithm))}`);
  console.log(`signing keys: one in_use ES256 key (${inUse[0].id})`);
  return keys;
}

async function patch(changes) {
  try {
    await api("PATCH", "/config/auth", changes);
    return [];
  } catch (err) {
    const pro = PRO_ONLY.filter((f) => f in changes);
    if (!pro.length || err.status !== 400 && err.status !== 402 && err.status !== 403) throw err;
    const rest = Object.fromEntries(Object.entries(changes).filter(([f]) => !pro.includes(f)));
    if (Object.keys(rest).length) await api("PATCH", "/config/auth", rest);
    return pro;
  }
}

async function main() {
  const want = desired();
  const current = await api("GET", "/config/auth");
  const changes = diff(current, want, args.has("--rotate-secrets"));
  const fields = Object.keys(changes);
  for (const f of fields) console.log(`${f}: ${show(f, current[f])} → ${show(f, changes[f])}`);
  if (!fields.length) console.log("auth config: no drift");

  const keys = await checkSigningKeys();
  const legacy = await api("GET", "/api-keys/legacy");
  console.log(`legacy api keys: ${legacy?.enabled ? "enabled" : "disabled"}`);

  if (mode === "check") {
    const hard = fields.filter((f) => !PRO_ONLY.includes(f));
    for (const f of fields.filter((f) => PRO_ONLY.includes(f))) console.log(`${f}: not enforced (Pro plan only)`);
    process.exit(hard.length ? 1 : 0);
  }

  if (changes.hook_before_user_created_enabled && !(await hookFunctionExists())) {
    fail(`refusing to enable the hook: ${HOOK_FN} does not exist (apply the migrations first)`);
  }
  if (fields.length) {
    const skipped = await patch(changes);
    for (const f of skipped) console.log(`${f}: skipped, requires Pro plan`);
    const after = await api("GET", "/config/auth");
    const left = Object.keys(diff(after, want, false)).filter((f) => !skipped.includes(f));
    if (left.length) fail(`still drifting after apply: ${left.join(", ")}`);
    console.log("auth config: applied");
  }

  if (args.has("--disable-legacy-keys")) {
    if (legacy?.enabled) await api("PUT", "/api-keys/legacy?enabled=false");
    const hs = keys.find((k) => k.algorithm === "HS256" && k.status !== "revoked");
    if (hs) await api("PATCH", `/config/auth/signing-keys/${hs.id}`, { status: "revoked" });
    console.log(`legacy api keys: disabled; legacy HS256 key: ${hs ? "revoked" : "already revoked"}`);
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));

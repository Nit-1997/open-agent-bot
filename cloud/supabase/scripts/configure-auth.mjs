#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { apiBaseFrom, managementApi } from "./managementApi.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SECRET_FIELDS = new Set(["smtp_pass", "external_google_secret"]);
const PRO_ONLY = ["sessions_timebox", "sessions_inactivity_timeout", "password_hibp_enabled"];
const EXPECTED_SECRET_KEYS = new Set(["agent", "admin_scripts"]);
const HOOK_FNS = ["private.before_user_created(jsonb)", "private.custom_access_token(jsonb)"];
const SIGNUP_MODES = ["invite", "waitlist", "open"];
const HOOK_VERSION = "oab:m7-signup-modes:v1";
const DRAFT_MARKER = "DRAFT-NOT-REVIEWED";
const MIN_BLOCKED_DOMAINS = 1000;
const OPEN_PROVIDERS = new Set(["email", "google"]);

const argv = process.argv.slice(2);
const args = new Set(argv);
const mode = args.has("--apply") ? "apply" : args.has("--check") ? "check" : undefined;
if (!mode) fail("usage: configure-auth.mjs --check | --apply [--rotate-secrets] [--disable-legacy-keys] [--i-confirm-open-signups]");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function env(name, { optional = false } = {}) {
  const v = process.env[name]?.trim();
  if (!v && !optional) fail(`missing ${name} (load cloud/deploy/env-files/.env-supabase-admin)`);
  return v ?? "";
}

let target;
try {
  target = apiBaseFrom(argv);
} catch (err) {
  fail(err.message);
}
const legalDir = (() => {
  const i = argv.indexOf("--legal-dir");
  if (i < 0) return fileURLToPath(new URL("../../web/content", import.meta.url));
  if (!target.fake) fail("--legal-dir is accepted only with --api-base (tests)");
  return resolve(argv[i + 1] ?? "");
})();
const signupMode = env("SIGNUP_MODE", { optional: true }) || "waitlist";
if (!SIGNUP_MODES.includes(signupMode)) fail(`SIGNUP_MODE must be one of ${SIGNUP_MODES.join(", ")}`);
const { api, read, write } = managementApi({ base: target.base, ref: env("SUPABASE_PROJECT_REF"), token: env("SUPABASE_ACCESS_TOKEN") });
const template = (name) => readFileSync(join(HERE, "..", "templates", name), "utf8");

function allowList() {
  const origins = ["https://app.localhost", env("PROD_ORIGIN", { optional: true })].filter(Boolean);
  return origins.flatMap((o) => [`${o}/auth/callback`, `${o}/auth/confirm`]).join(",");
}

function desired() {
  return {
    site_url: env("SITE_URL"),
    uri_allow_list: allowList(),
    disable_signup: signupMode !== "open",
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
    hook_custom_access_token_enabled: true,
    hook_custom_access_token_uri: "pg-functions://postgres/private/custom_access_token",
    security_captcha_enabled: false,
    password_min_length: 12,
    password_hibp_enabled: true,
    security_update_password_require_reauthentication: true,
    security_update_password_require_current_password: true,
    mailer_notifications_password_changed_enabled: true,
    mfa_totp_enroll_enabled: false,
    mfa_totp_verify_enabled: false,
    mfa_phone_enroll_enabled: false,
    mfa_phone_verify_enabled: false,
    mfa_web_authn_enroll_enabled: false,
    mfa_web_authn_verify_enabled: false,
  };
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

async function missingHookFunctions() {
  const missing = [];
  for (const fn of HOOK_FNS) {
    const rows = await read(`select to_regprocedure('${fn}') is not null as ok`);
    if (rows?.[0]?.ok !== true) missing.push(fn);
  }
  return missing;
}

async function modeRow() {
  try {
    const rows = await read("select mode from public.signup_settings where id");
    return rows?.length === 1 ? rows[0].mode : null;
  } catch {
    return null;
  }
}

function providerProblems(config) {
  if (signupMode !== "open") return [];
  const problems = [];
  for (const [field, value] of Object.entries(config)) {
    const m = /^external_([a-z0-9_]+)_enabled$/.exec(field);
    if (m && value === true && !OPEN_PROVIDERS.has(m[1]))
      problems.push(`provider ${m[1]} is on (open signups allow only Google and email links)`);
  }
  if (config.saml_enabled === true) problems.push("SAML is on (open signups allow only Google and email links)");
  return problems;
}

async function one(query, field) {
  try {
    return (await read(query))?.[0]?.[field];
  } catch {
    return undefined;
  }
}

async function openPreconditions() {
  const failed = [];
  if (
    (await one("select to_regprocedure('public.request_admit(uuid,integer,integer,timestamp with time zone)') is not null as ok", "ok")) !==
    true
  )
    failed.push("(a) the M7 usage functions are missing (apply the migrations first: Gate 8)");
  if ((await one("select count(*)::int as n from public.signup_settings", "n")) !== 1)
    failed.push("(b) public.signup_settings is missing or doesn't hold exactly one row");
  const version = await one("select obj_description(to_regprocedure('private.before_user_created(jsonb)'), 'pg_proc') as v", "v");
  if (version !== HOOK_VERSION) failed.push(`(c) private.before_user_created isn't the ${HOOK_VERSION} hook`);
  const domains = await one("select count(*)::int as n from public.blocked_email_domains", "n");
  if (!(domains >= MIN_BLOCKED_DOMAINS))
    failed.push(
      `(d) blocked_email_domains holds ${domains ?? "no"} rows, fewer than ${MIN_BLOCKED_DOMAINS} (run blocked-domains.mjs --apply)`,
    );
  for (const name of ["terms.md", "privacy.md"]) {
    const file = join(legalDir, name);
    if (!existsSync(file)) failed.push(`(e) cloud/web/content/${name} is missing`);
    else if (readFileSync(file, "utf8").includes(DRAFT_MARKER))
      failed.push(`(e) cloud/web/content/${name} is still marked ${DRAFT_MARKER}`);
  }
  if (!args.has("--i-confirm-open-signups")) failed.push("(f) pass --i-confirm-open-signups to open signups");
  return failed;
}

async function writeMode() {
  await write(`update public.signup_settings set mode = '${signupMode}', updated_at = now() where id`);
  const now = await modeRow();
  if (now !== signupMode) fail(`signup mode is still ${now ?? "unknown"} after the update`);
  console.log(`signup mode: ${signupMode}`);
}

async function keyDrift() {
  const res = await api("GET", "/config/auth/signing-keys");
  const signing = Array.isArray(res) ? res : (res?.keys ?? []);
  const apiKeys = (await api("GET", "/api-keys?reveal=false")) ?? [];
  const legacy = await api("GET", "/api-keys/legacy");
  const inUse = signing.filter((k) => k.status === "in_use");
  const legacySigning = signing.filter((k) => k.algorithm === "HS256" && k.status !== "revoked");
  const extraSecrets = apiKeys.filter((k) => k.type === "secret" && !EXPECTED_SECRET_KEYS.has(k.name));
  const missingSecrets = [...EXPECTED_SECRET_KEYS].filter((name) => !apiKeys.some((k) => k.type === "secret" && k.name === name));
  const problems = [];
  if (inUse.length !== 1 || inUse[0].algorithm !== "ES256")
    problems.push(`signing keys: expected one in_use ES256 key, found ${JSON.stringify(inUse.map((k) => k.algorithm))}`);
  for (const k of legacySigning)
    problems.push(`signing keys: legacy HS256 key is ${k.status}, not revoked (anyone with the old JWT secret can mint tokens)`);
  if (legacy?.enabled) problems.push("api keys: legacy anon and service_role keys are enabled");
  for (const k of extraSecrets)
    problems.push(`api keys: unexpected secret key "${k.name}" (only ${[...EXPECTED_SECRET_KEYS].join(", ")} should exist)`);
  for (const name of missingSecrets) problems.push(`api keys: expected secret key "${name}" is missing`);
  return { signing, legacy, legacySigning, extraSecrets, problems };
}

async function patch(changes) {
  try {
    await api("PATCH", "/config/auth", changes);
    return [];
  } catch (err) {
    const pro = PRO_ONLY.filter((f) => f in changes);
    if (!pro.length || (err.status !== 400 && err.status !== 402 && err.status !== 403)) throw err;
    const rest = Object.fromEntries(Object.entries(changes).filter(([f]) => !pro.includes(f)));
    if (Object.keys(rest).length) await api("PATCH", "/config/auth", rest);
    return pro;
  }
}

async function disableLegacyKeys(keys) {
  if (keys.legacy?.enabled) await api("PUT", "/api-keys/legacy?enabled=false");
  for (const k of keys.legacySigning) await api("PATCH", `/config/auth/signing-keys/${k.id}`, { status: "revoked" });
  for (const k of keys.extraSecrets) await api("DELETE", `/api-keys/${k.id}`);
  console.log(
    `legacy api keys: disabled; HS256 keys revoked: ${keys.legacySigning.length}; secret keys deleted: ${keys.extraSecrets.map((k) => k.name).join(", ") || "none"}`,
  );
}

async function main() {
  const want = desired();
  const current = await api("GET", "/config/auth");
  const changes = diff(current, want, args.has("--rotate-secrets"));
  const fields = Object.keys(changes);
  for (const f of fields) console.log(`${f}: ${show(f, current[f])} → ${show(f, changes[f])}`);
  if (!fields.length) console.log("auth config: no drift");

  const keys = await keyDrift();
  for (const p of keys.problems) console.log(`drift: ${p}`);
  if (!keys.problems.length) console.log("keys: no drift");

  const row = await modeRow();
  const rowDrift = row === null ? signupMode === "open" : row !== signupMode;
  if (row === null)
    console.log(`signup mode: public.signup_settings missing (pre-M7 database: the hook is invite-only)${rowDrift ? ", want open" : ""}`);
  else console.log(rowDrift ? `drift: signup mode ${row} → ${signupMode}` : `signup mode: ${row}, no drift`);
  const providers = providerProblems(current);
  for (const p of providers) console.log(`drift: ${p}`);

  if (mode === "check") {
    const hard = fields.filter((f) => !PRO_ONLY.includes(f));
    for (const f of fields.filter((f) => PRO_ONLY.includes(f))) console.log(`${f}: not enforced (paid plan only)`);
    if (keys.problems.length) console.log("fix key drift with: configure-auth.mjs --apply --disable-legacy-keys");
    process.exit(hard.length || keys.problems.length || rowDrift || providers.length ? 1 : 0);
  }

  if (signupMode === "open") {
    const failed = [...(await openPreconditions()), ...providerProblems({ ...current, ...want })];
    if (failed.length) fail(`refusing to open signups:\n${failed.map((f) => `  ${f}`).join("\n")}`);
  }

  if (changes.hook_before_user_created_enabled || changes.hook_custom_access_token_enabled) {
    const missing = await missingHookFunctions();
    if (missing.length) fail(`refusing to enable hooks: ${missing.join(", ")} missing (apply the migrations first)`);
  }
  const opening = signupMode === "open";
  if (opening && rowDrift) await writeMode();
  if (fields.length) {
    const skipped = await patch(changes);
    for (const f of skipped) console.log(`${f}: skipped, requires a paid plan`);
    const after = await api("GET", "/config/auth");
    const left = Object.keys(diff(after, want, false)).filter((f) => !skipped.includes(f));
    if (left.length) fail(`still drifting after apply: ${left.join(", ")}`);
    console.log("auth config: applied");
  }
  if (!opening && row !== null && rowDrift) await writeMode();

  if (args.has("--disable-legacy-keys")) await disableLegacyKeys(keys);
  else if (keys.problems.length) console.log("key drift left alone; rerun with --disable-legacy-keys to fix it");
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));

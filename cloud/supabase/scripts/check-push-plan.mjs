#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MIGRATIONS_DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "migrations");
export const M7_MIGRATIONS = Object.freeze(["20261104092535_request_usage.sql", "20261104113650_signup_modes.sql"]);

const USAGE =
  "usage: <the CLI's dry-run output> | check-push-plan.mjs [--applied]\n       check-push-plan.mjs --pre-m7-versions | --pre-m7-query";

export const PRE_M7_MIGRATIONS = Object.freeze([
  "20261101060613_foundation.sql",
  "20261101060619_profiles.sql",
  "20261101060633_access.sql",
  "20261101060645_chats_workspace.sql",
  "20261101060651_artifacts.sql",
  "20261101060659_providers.sql",
  "20261101073603_no_password_tokens.sql",
  "20261101214044_app_shell_search.sql",
  "20261101225832_workspace_counts.sql",
  "20261101235026_chat_message_parts.sql",
  "20261102000914_artifact_thumbnails.sql",
  "20261102034812_drop_workspace_entities.sql",
]);

export const preM7Migrations = () => [...PRE_M7_MIGRATIONS];
export const preM7Versions = () => PRE_M7_MIGRATIONS.map((f) => f.split("_")[0]);

export const PRE_M7_CHECKS = Object.freeze([
  ["public.profiles", "to_regclass('public.profiles') is null"],
  ["public.invited_emails", "to_regclass('public.invited_emails') is null"],
  ["public.access_requests", "to_regclass('public.access_requests') is null"],
  ["public.chats", "to_regclass('public.chats') is null"],
  ["public.chat_messages", "to_regclass('public.chat_messages') is null"],
  ["public.artifacts", "to_regclass('public.artifacts') is null"],
  ["public.provider_credentials", "to_regclass('public.provider_credentials') is null"],
  ["public.provider_settings", "to_regclass('public.provider_settings') is null"],
  ["private.handle_new_user()", "to_regprocedure('private.handle_new_user()') is null"],
  ["private.before_user_created(jsonb)", "to_regprocedure('private.before_user_created(jsonb)') is null"],
  ["private.custom_access_token(jsonb)", "to_regprocedure('private.custom_access_token(jsonb)') is null"],
  [
    "chat_messages.parts",
    "not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'chat_messages' and column_name = 'parts')",
  ],
  [
    "artifacts.thumb_path",
    "not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'artifacts' and column_name = 'thumb_path')",
  ],
  ["workspace_entities dropped", "to_regclass('public.workspace_entities') is not null"],
  ["no M7 table yet", "to_regclass('public.request_usage') is not null or to_regclass('public.signup_settings') is not null"],
]);

export function preM7Query() {
  const rows = PRE_M7_CHECKS.map(([label, failing]) => `(case when ${failing} then '${label}' end)`).join(", ");
  return `select coalesce(string_agg(problem, '; '), 'pre-M7 objects present') from (values ${rows}) as v(problem)`;
}

const ESC = String.fromCharCode(27);
const strip = (s) =>
  s
    .split(ESC)
    .map((part, i) => (i === 0 ? part : part.replace(/^\[[0-9;]*m/, "")))
    .join("");

export function parsePlan(text) {
  const lines = strip(text).split("\n");
  let plan;
  for (const l of lines) {
    if (!l.trim().startsWith("{")) continue;
    try {
      const j = JSON.parse(l.trim());
      if (Array.isArray(j.migrations) && j.migrations.every((m) => typeof m === "string") && typeof j.dryRun === "boolean")
        plan = { dryRun: j.dryRun, upToDate: j.upToDate === true, migrations: j.migrations };
    } catch {}
  }
  if (!plan) return undefined;
  const at = lines.findIndex((l) => /^Would push these migrations:/.test(l.trim()));
  const bullets = [];
  if (at >= 0)
    for (const l of lines.slice(at + 1)) {
      const m = /^\s*•\s+(\S+)\s*$/.exec(l);
      if (!m) break;
      bullets.push(m[1]);
    }
  return { ...plan, bullets };
}

export function checkPlan(plan, { applied = false, expected = M7_MIGRATIONS, pre = preM7Migrations() } = {}) {
  if (!plan) return { code: 2, lines: ["STOP: no dry-run plan in the input (did the CLI fail? its error is above)"] };
  if (!plan.dryRun) return { code: 2, lines: ["STOP: this is not a dry run; pass --dry-run"] };
  if (plan.bullets.length && plan.bullets.join(" ") !== plan.migrations.join(" "))
    return { code: 2, lines: ["STOP: the CLI's bullet list and the JSON line differ"] };
  const got = plan.migrations;
  if (applied)
    return got.length === 0
      ? { code: 0, lines: ["up to date: nothing left to push"] }
      : { code: 1, lines: [`STOP: still ${got.length} to push: ${got.join(", ")}`] };
  if (got.length === 0) return { code: 1, lines: ["STOP: the database is already up to date; nothing would be pushed"] };
  const old = got.filter((m) => pre.includes(m));
  if (old.length)
    return {
      code: 3,
      lines: [
        `history repair needed: the dry run lists ${old.length} pre-M7 migration${old.length === 1 ? "" : "s"}, so the database's migration history doesn't know them (they were applied by pasting their SQL).`,
        "Don't push. Follow the history-repair step of Gate 8 in cloud/README.md; the versions to mark as applied:",
        preM7Versions().join(" "),
      ],
    };
  const extra = got.filter((m) => !expected.includes(m));
  const missing = expected.filter((m) => !got.includes(m));
  if (extra.length || missing.length)
    return {
      code: 1,
      lines: [
        "STOP: the plan is not exactly the two M7 migrations",
        ...extra.map((m) => `extra: ${m}`),
        ...missing.map((m) => `missing: ${m}`),
      ],
    };
  if (got.join(" ") !== expected.join(" ")) return { code: 1, lines: [`STOP: wrong order: ${got.join(", ")}`] };
  return { code: 0, lines: ["the plan lists exactly the two M7 migrations, in order:", ...got.map((m) => `  ${m}`)] };
}

export function main(argv, input, { out = console.log, err = console.error } = {}) {
  const flags = new Set(argv);
  const known = ["--applied", "--pre-m7-versions", "--pre-m7-query"];
  if (argv.some((a) => !known.includes(a)) || flags.size > 1) {
    err(USAGE);
    return 2;
  }
  if (flags.has("--pre-m7-versions")) {
    out(preM7Versions().join(" "));
    return 0;
  }
  if (flags.has("--pre-m7-query")) {
    out(preM7Query());
    return 0;
  }
  const r = checkPlan(parsePlan(input()), { applied: flags.has("--applied") });
  for (const l of r.lines) (r.code === 0 ? out : err)(l);
  return r.code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2), () => readFileSync(0, "utf8"));

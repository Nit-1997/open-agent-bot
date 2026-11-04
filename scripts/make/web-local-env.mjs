#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EXAMPLE = join(ROOT, "cloud/deploy-config/env-files/backend/.env.example");
const LIMITS = ["LIMIT_RUNNING_PER_USER", "LIMIT_REQUESTS_PER_HOUR", "LIMIT_REQUESTS_PER_MONTH", "LIMIT_RUNNING_SERVER"];
const STACK = ["OAB_SB_API_URL", "OAB_SB_DB_URL", "OAB_SB_PUBLISHABLE_KEY", "OAB_SB_SECRET_KEY", "OAB_SB_MAIL_URL"];
const LIMIT_MAX = 1000000;
const SAFE = /^[A-Za-z0-9_.:/@=+-]+$/;
export const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";

const fail = (msg) => {
  process.stderr.write(`web-local-env: ${msg}\n`);
  process.exit(1);
};

export function limitDefaults(text) {
  const found = {};
  for (const line of text.split("\n")) {
    const m = /^(LIMIT_[A-Z_]+)=(\d+)$/.exec(line.trim());
    if (m && LIMITS.includes(m[1])) found[m[1]] = m[2];
  }
  const missing = LIMITS.filter((k) => !(k in found));
  if (missing.length) throw new Error(`the backend .env.example has no default for ${missing.join(", ")}`);
  return found;
}

export function limitsFrom(env, defaults) {
  const out = {};
  for (const k of LIMITS) {
    const raw = env[k] === undefined || env[k] === "" ? defaults[k] : env[k].trim();
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > LIMIT_MAX)
      throw new Error(`${k} must be a whole number from 1 to ${LIMIT_MAX} (got ${JSON.stringify(env[k])})`);
    out[k] = String(Number(raw));
  }
  return out;
}

export function stackValues(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = /^export ([A-Z_]+)='([^']*)'$/.exec(line.trim());
    if (m && STACK.includes(m[1])) out[m[1]] = m[2];
  }
  const missing = STACK.filter((k) => !out[k] || !SAFE.test(out[k]));
  if (missing.length) throw new Error(`the local stack env lacks a usable ${missing.join(", ")}`);
  return out;
}

export function generated() {
  return {
    AGENT_SERVICE_SECRET: randomBytes(32).toString("hex"),
    RENDERER_SECRET: randomBytes(32).toString("hex"),
    CREDENTIAL_KEYS: `v1:${randomBytes(32).toString("base64")}`,
    ACCESS_REQUEST_PEPPER: randomBytes(32).toString("base64"),
    TURNSTILE_SECRET_KEY: TURNSTILE_TEST_SECRET,
    TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEY,
  };
}

function main() {
  const { values } = parseArgs({ options: { stack: { type: "string" }, out: { type: "string" }, "limits-only": { type: "boolean" } } });
  let limits;
  try {
    limits = limitsFrom(process.env, limitDefaults(readFileSync(EXAMPLE, "utf8")));
  } catch (e) {
    fail(e.message);
  }
  if (values["limits-only"]) {
    process.stdout.write(`${LIMITS.map((k) => `${k}=${limits[k]}`).join(" ")}\n`);
    return;
  }
  if (!values.stack || !values.out) fail("usage: web-local-env.mjs --stack <stack.env> --out <env> | --limits-only");
  let stack;
  try {
    stack = stackValues(readFileSync(values.stack, "utf8"));
  } catch (e) {
    fail(e.message);
  }
  const all = { ...stack, ...generated(), ...limits };
  const text = `${Object.entries(all)
    .map(([k, v]) => `export ${k}='${v}'`)
    .join("\n")}\n`;
  try {
    writeFileSync(values.out, text, { mode: 0o600, flag: "wx" });
  } catch (e) {
    fail(`could not write ${values.out}: ${e.code ?? e.message}`);
  }
  process.stdout.write(`${LIMITS.map((k) => `${k}=${limits[k]}`).join(" ")}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

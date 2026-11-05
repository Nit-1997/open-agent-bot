import { pathToFileURL } from "node:url";
import { adminEnv, createAdmin, run } from "./admin.mjs";

export const TEST_EMAIL_PATTERN = "oab-e2e+%@example.test";
export const INTEGRATION_EMAIL_PATTERN = "oab-test+%@example.test";
export const EMAIL_TABLES = ["profiles", "invited_emails", "access_requests"];

const [PREFIX, SUFFIX] = TEST_EMAIL_PATTERN.split("%");
const [INTEGRATION_PREFIX, INTEGRATION_SUFFIX] = INTEGRATION_EMAIL_PATTERN.split("%");
const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isTestEmail(email) {
  if (typeof email !== "string" || !email.startsWith(PREFIX) || !email.endsWith(SUFFIX)) return false;
  return /^[a-z0-9._-]+$/i.test(email.slice(PREFIX.length, email.length - SUFFIX.length));
}

export function isIntegrationEmail(email) {
  if (typeof email !== "string" || !email.startsWith(INTEGRATION_PREFIX) || !email.endsWith(INTEGRATION_SUFFIX)) return false;
  return LOWER_UUID.test(email.slice(INTEGRATION_PREFIX.length, email.length - INTEGRATION_SUFFIX.length));
}

export async function testAuthUsers(admin, match = isTestEmail) {
  const found = [];
  for (let page = 1; ; page++) {
    const users = await admin.listUsers(page);
    found.push(...users.filter((u) => match(u.email)));
    if (users.length < admin.pageSize) return found;
  }
}

export function emailRows({ url, key }) {
  async function rest(method, path, prefer) {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      method,
      headers: { apikey: key, ...(prefer && { prefer }) },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path.split("?")[0]} failed: HTTP ${res.status}`);
    return text ? JSON.parse(text) : null;
  }
  return {
    async emailsLike(table, pattern) {
      const rows = await rest("GET", `${table}?select=email&email=like.${encodeURIComponent(pattern)}`);
      return (rows ?? []).map((r) => r.email);
    },
    async deleteEmail(table, email) {
      await rest("DELETE", `${table}?email=eq.${encodeURIComponent(email)}`, "return=minimal");
    },
  };
}

export async function markHumanChecked({ url, key }, userIds) {
  if (!userIds.length) return 0;
  const res = await fetch(`${url}/rest/v1/human_checks?on_conflict=user_id`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json", prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(userIds.map((user_id) => ({ user_id }))),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`human_checks upsert failed: HTTP ${res.status}`);
  return userIds.length;
}

export async function humanCheckTestUsers(admin, env) {
  const users = [...(await testAuthUsers(admin)), ...(await testAuthUsers(admin, isIntegrationEmail))];
  return markHumanChecked(env, [...new Set(users.map((u) => u.id))]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(async () => {
    if (!process.argv.includes("--human-checked")) throw new Error("usage: test-users.mjs --human-checked");
    const env = adminEnv();
    console.log(`human-checked test users: ${await humanCheckTestUsers(createAdmin(env), env)}`);
  });
}

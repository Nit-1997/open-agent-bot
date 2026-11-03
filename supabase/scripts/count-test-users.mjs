#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { adminEnv, run } from "./admin.mjs";

const TEST_EMAIL = /^oab-e2e\+.*@example\.test$/;
const TEST_PATTERN = "oab-e2e+%@example.test";
const TABLES = ["profiles", "invited_emails", "access_requests"];
const PAGE_SIZE = 1000;

async function countAuthUsers({ url, key }) {
  let total = 0;
  for (let page = 1; ; page++) {
    const res = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=${PAGE_SIZE}`, {
      headers: { apikey: key },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`auth users: HTTP ${res.status}`);
    const users = (await res.json()).users ?? [];
    total += users.filter((u) => TEST_EMAIL.test(u.email ?? "")).length;
    if (users.length < PAGE_SIZE) return total;
  }
}

async function countRows({ url, key }, table) {
  const res = await fetch(`${url}/rest/v1/${table}?select=*&email=like.${encodeURIComponent(TEST_PATTERN)}`, {
    method: "HEAD",
    headers: { apikey: key, prefer: "count=exact" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status}`);
  const count = Number(res.headers.get("content-range")?.split("/")[1]);
  if (!Number.isInteger(count)) throw new Error(`${table}: no count in the response`);
  return count;
}

export async function countTestUsers(env) {
  const counts = { auth_users: await countAuthUsers(env) };
  for (const table of TABLES) counts[table] = await countRows(env, table);
  return counts;
}

export function formatCounts(counts) {
  return {
    lines: Object.entries(counts).map(([name, n]) => `${name} ${n}`),
    clean: Object.values(counts).every((n) => n === 0),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(async () => {
    const { lines, clean } = formatCounts(await countTestUsers(adminEnv()));
    for (const line of lines) console.log(line);
    if (!clean) throw new Error("oab-e2e test data remains");
  });
}

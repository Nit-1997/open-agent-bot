#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { adminEnv, createAdmin, run } from "./admin.mjs";
import { TEST_EMAIL_PATTERN, testAuthUsers } from "./test-users.mjs";

const TABLES = ["profiles", "invited_emails", "access_requests"];

export async function countTestUsers(env) {
  const admin = createAdmin(env);
  const counts = { auth_users: (await testAuthUsers(admin)).length };
  for (const table of TABLES) counts[table] = await admin.countLike(table, TEST_EMAIL_PATTERN);
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

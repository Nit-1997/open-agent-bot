#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { adminEnv, createAdmin, run } from "./admin.mjs";
import { EMAIL_TABLES, emailRows, INTEGRATION_EMAIL_PATTERN, isIntegrationEmail, TEST_EMAIL_PATTERN, testAuthUsers } from "./test-users.mjs";

export async function countTestUsers(env, { integration = false } = {}) {
  const admin = createAdmin(env);
  if (integration) {
    const rows = emailRows(env);
    const counts = { auth_users: (await testAuthUsers(admin, isIntegrationEmail)).length };
    for (const table of EMAIL_TABLES)
      counts[table] = (await rows.emailsLike(table, INTEGRATION_EMAIL_PATTERN)).filter(isIntegrationEmail).length;
    return counts;
  }
  const counts = { auth_users: (await testAuthUsers(admin)).length };
  for (const table of EMAIL_TABLES) counts[table] = await admin.countLike(table, TEST_EMAIL_PATTERN);
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
    const integration = process.argv.includes("--integration");
    const { lines, clean } = formatCounts(await countTestUsers(adminEnv(), { integration }));
    for (const line of lines) console.log(line);
    if (!clean) throw new Error(integration ? "oab-test integration data remains" : "oab-e2e test data remains");
  });
}

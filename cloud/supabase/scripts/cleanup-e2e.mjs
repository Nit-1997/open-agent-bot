#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { adminEnv, createAdmin, run } from "./admin.mjs";
import {
  emailRows,
  INTEGRATION_EMAIL_PATTERN,
  isIntegrationEmail,
  isTestEmail,
  TEST_EMAIL_PATTERN,
  testAuthUsers,
} from "./test-users.mjs";

export async function cleanupTestUsers(admin) {
  const targets = new Map();
  for (const p of await admin.profilesLike(TEST_EMAIL_PATTERN)) {
    if (isTestEmail(p.email)) targets.set(p.user_id, p.email);
  }
  for (const u of await testAuthUsers(admin)) targets.set(u.id, u.email);
  for (const [id, email] of targets) await admin.deleteUser(id, email);
  await admin.deleteRequestsLike(TEST_EMAIL_PATTERN);
  return [...targets.keys()];
}

export async function cleanupIntegrationUsers(admin, rows) {
  const targets = new Map();
  for (const p of await admin.profilesLike(INTEGRATION_EMAIL_PATTERN)) {
    if (isIntegrationEmail(p.email)) targets.set(p.user_id, p.email);
  }
  for (const u of await testAuthUsers(admin, isIntegrationEmail)) targets.set(u.id, u.email);
  for (const [id, email] of targets) await admin.deleteUser(id, email);
  for (const table of ["invited_emails", "access_requests"]) {
    for (const email of await rows.emailsLike(table, INTEGRATION_EMAIL_PATTERN)) {
      if (isIntegrationEmail(email)) await rows.deleteEmail(table, email);
    }
  }
  return [...targets.keys()];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(async () => {
    const env = adminEnv();
    const admin = createAdmin(env);
    const integration = process.argv.includes("--integration");
    const deleted = integration ? await cleanupIntegrationUsers(admin, emailRows(env)) : await cleanupTestUsers(admin);
    for (const id of deleted) console.log(`deleted ${id}`);
    console.log(`remaining users: ${await admin.countUsers()}`);
  });
}

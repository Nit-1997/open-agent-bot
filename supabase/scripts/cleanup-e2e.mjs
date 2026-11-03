#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { adminEnv, createAdmin, run } from "./admin.mjs";
import { isTestEmail, TEST_EMAIL_PATTERN, testAuthUsers } from "./test-users.mjs";

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(async () => {
    const admin = createAdmin(adminEnv());
    for (const id of await cleanupTestUsers(admin)) console.log(`deleted ${id}`);
    console.log(`remaining users: ${await admin.countUsers()}`);
  });
}

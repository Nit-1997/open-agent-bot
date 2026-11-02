#!/usr/bin/env node
import { adminEnv, createAdmin, run } from "./admin.mjs";

const PATTERNS = ["ntnbhat9+oab-e2e%@gmail.com", "%@example.test"];

run(async () => {
  const admin = createAdmin(adminEnv());
  for (const pattern of PATTERNS) {
    for (const p of await admin.profilesLike(pattern)) {
      await admin.deleteUser(p.user_id, p.email);
      console.log(`deleted ${p.user_id}`);
    }
    await admin.deleteRequestsLike(pattern);
  }
  console.log(`remaining users: ${await admin.countUsers()}`);
});

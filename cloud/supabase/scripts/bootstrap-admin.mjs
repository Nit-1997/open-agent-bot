#!/usr/bin/env node
import { adminEnv, createAdmin, normalizeEmail, run } from "./admin.mjs";

run(async () => {
  const args = process.argv.slice(2);
  const asUser = args.includes("--user");
  const email = normalizeEmail(args.find((a) => !a.startsWith("--")));
  const env = adminEnv();
  const admin = createAdmin(env);

  await admin.inviteEmail(email);
  const profile = await admin.profileByEmail(email);
  let id;
  if (!profile) {
    const user = await admin.createUser({ email, email_confirm: true, ...(!asUser && { app_metadata: { role: "admin" } }) });
    id = user.id;
    console.log(`created ${asUser ? "user" : "admin"} ${id}`);
  } else {
    id = profile.user_id;
    if (!asUser) {
      const user = await admin.getUser(id);
      await admin.updateUser(id, { app_metadata: { ...user.app_metadata, role: "admin" } });
      console.log(`granted admin to ${id}`);
    } else {
      console.log(`user exists ${id}`);
    }
  }
  console.log(`Sign in with Google at ${env.appOrigin}/login`);
});

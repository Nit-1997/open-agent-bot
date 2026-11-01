#!/usr/bin/env node
import { adminEnv, createAdmin, normalizeEmail, run } from "./admin.mjs";

run(async () => {
  const email = normalizeEmail(process.argv[2]);
  const env = adminEnv();
  const admin = createAdmin(env);
  const member = await admin.profileByEmail(email);
  const type = member ? "magiclink" : "invite";
  const link = await admin.generateLink({ type, email, redirect_to: `${env.appOrigin}/auth/confirm` });
  const hashed = link.hashed_token ?? link.properties?.hashed_token;
  if (!hashed) throw new Error("generateLink returned no hashed_token");
  console.log(`${env.appOrigin}/auth/confirm?token_hash=${hashed}&type=${member ? "email" : "invite"}&email=${encodeURIComponent(email)}`);
});

import { clearAuthDir } from "./support/authFiles";
import { AUTH_DIR } from "./support/env";
import { cleanupE2e } from "./support/users";

export default async function globalTeardown(): Promise<number> {
  const removed = cleanupE2e();
  const files = clearAuthDir(AUTH_DIR);
  console.log(`e2e teardown: removed ${removed} test users and ${files} sign-in state files`);
  return removed;
}

export const TEST_EMAIL_PATTERN = "oab-e2e+%@example.test";

const [PREFIX, SUFFIX] = TEST_EMAIL_PATTERN.split("%");

export function isTestEmail(email) {
  if (typeof email !== "string" || !email.startsWith(PREFIX) || !email.endsWith(SUFFIX)) return false;
  return /^[a-z0-9._-]+$/i.test(email.slice(PREFIX.length, email.length - SUFFIX.length));
}

export async function testAuthUsers(admin) {
  const found = [];
  for (let page = 1; ; page++) {
    const users = await admin.listUsers(page);
    found.push(...users.filter((u) => isTestEmail(u.email)));
    if (users.length < admin.pageSize) return found;
  }
}

import type { VerifiedUser } from "../../src/identity/verify.js";
import type { Principal } from "@oab/core/identity/types.js";

export * from "../../../../packages/core/test/fixtures/users.js";

export const verified = (u: Principal): VerifiedUser => ({
  id: u.id,
  email: u.email,
  sessionId: `s-${u.id}`,
  isAdmin: u.capabilities.admin,
});

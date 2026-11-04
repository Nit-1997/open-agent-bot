import type { VerifiedUser } from "../../../src/hosted/identity/verify.js";
import type { Principal } from "../../../src/identity/types.js";

export * from "../../fixtures/users.js";

export const verified = (u: Principal): VerifiedUser => ({
  id: u.id,
  email: u.email,
  sessionId: `s-${u.id}`,
  isAdmin: u.capabilities.admin,
});

import type { VerifiedUser } from "../../src/hosted/identity/verify.js";
import type { Principal } from "../../src/identity/types.js";

export const ALICE: Principal = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "alice@example.test",
  isAdmin: false,
};
export const BOB: Principal = { id: "22222222-2222-4222-8222-222222222222", email: "bob@example.test", isAdmin: false };
export const ADMIN: Principal = { id: "33333333-3333-4333-8333-333333333333", email: "admin@example.test", isAdmin: true };

export const verified = (u: Principal): VerifiedUser => ({ ...u, sessionId: `s-${u.id}` });

export const CHAT_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const CHAT_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

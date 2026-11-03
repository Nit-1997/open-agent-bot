import type { AuthUser } from "../../src/auth/verify.js";

export const ALICE: AuthUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "alice@example.test",
  sessionId: "s-a",
  isAdmin: false,
};
export const BOB: AuthUser = { id: "22222222-2222-4222-8222-222222222222", email: "bob@example.test", sessionId: "s-b", isAdmin: false };
export const ADMIN: AuthUser = { id: "33333333-3333-4333-8333-333333333333", email: "admin@example.test", sessionId: "s-c", isAdmin: true };

export const CHAT_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const CHAT_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

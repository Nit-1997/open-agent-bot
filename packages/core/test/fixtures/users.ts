import { type Capabilities, NO_CAPABILITIES, type Principal } from "../../src/identity/types.js";

export const ALL_CAPABILITIES: Capabilities = Object.freeze({ admin: true, privateNetworkModels: true, operatorGateway: true });

export const ALICE: Principal = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "alice@example.test",
  capabilities: NO_CAPABILITIES,
};
export const BOB: Principal = { id: "22222222-2222-4222-8222-222222222222", email: "bob@example.test", capabilities: NO_CAPABILITIES };
export const ADMIN: Principal = { id: "33333333-3333-4333-8333-333333333333", email: "admin@example.test", capabilities: ALL_CAPABILITIES };

export const CHAT_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const CHAT_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

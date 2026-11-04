import { AuthError } from "../../src/identity/verify.js";
import { NO_CAPABILITIES, type Principal } from "@oab/core/identity/types.js";
import type { IdentitySeams } from "./hostedApp.js";
import { tokenFor } from "./hostedApp.js";
import { TEST_SECRET } from "./config.js";
import { ADMIN, ALICE, ALL_CAPABILITIES, BOB, verified } from "./users.js";

const principal = (n: number, name: string, isAdmin: boolean): Principal => ({
  id: `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`,
  email: `${name}@example.test`,
  capabilities: isAdmin ? ALL_CAPABILITIES : NO_CAPABILITIES,
});

export const DEACTIVATED = principal(4, "deactivated", false);
export const STATUS_THROWS = principal(5, "status-throws", false);
export const ADMIN_NOT_LIVE = principal(6, "admin-not-live", true);
export const ADMIN_LIVE_THROWS = principal(7, "admin-live-throws", true);
export const KNOWN = [ALICE, BOB, ADMIN, DEACTIVATED, STATUS_THROWS, ADMIN_NOT_LIVE, ADMIN_LIVE_THROWS];
export const EXTRA_ACCOUNTS = [DEACTIVATED, STATUS_THROWS, ADMIN_NOT_LIVE, ADMIN_LIVE_THROWS];
const FAILING_TOKENS = { "t.jwks-down": "auth_unavailable", "t.expired": "expired_token", "t.invalid": "invalid_token" } as const;

export type Caller = { name: string; secret: string | null; bearer?: string; user?: Principal };

export const CALLERS: Caller[] = [
  { name: "NO_SECRET", secret: null, bearer: tokenFor(ALICE) },
  { name: "SECRET_NO_BEARER", secret: TEST_SECRET },
  { name: "WRONG_SECRET", secret: `${TEST_SECRET.slice(1)}b`, bearer: tokenFor(ALICE) },
  { name: "ALICE", secret: TEST_SECRET, bearer: tokenFor(ALICE), user: ALICE },
  { name: "BOB", secret: TEST_SECRET, bearer: tokenFor(BOB), user: BOB },
  { name: "ADMIN", secret: TEST_SECRET, bearer: tokenFor(ADMIN), user: ADMIN },
  { name: "DEACTIVATED", secret: TEST_SECRET, bearer: tokenFor(DEACTIVATED) },
  { name: "STATUS_THROWS", secret: TEST_SECRET, bearer: tokenFor(STATUS_THROWS) },
  { name: "JWKS_DOWN", secret: TEST_SECRET, bearer: "t.jwks-down" },
  { name: "EXPIRED", secret: TEST_SECRET, bearer: "t.expired" },
  { name: "INVALID", secret: TEST_SECRET, bearer: "t.invalid" },
  { name: "ADMIN_NOT_LIVE", secret: TEST_SECRET, bearer: tokenFor(ADMIN_NOT_LIVE), user: ADMIN_NOT_LIVE },
  { name: "ADMIN_LIVE_THROWS", secret: TEST_SECRET, bearer: tokenFor(ADMIN_LIVE_THROWS), user: ADMIN_LIVE_THROWS },
];

export function matrixSeams(): IdentitySeams {
  const tokens = new Map(KNOWN.map((u) => [tokenFor(u), u]));
  const live = new Map<string, () => Promise<boolean>>([
    [ADMIN_NOT_LIVE.id, async () => false],
    [ADMIN_LIVE_THROWS.id, async () => Promise.reject(new Error("auth admin down"))],
  ]);
  return {
    verify: async (token) => {
      const failure = FAILING_TOKENS[token as keyof typeof FAILING_TOKENS];
      if (failure) throw new AuthError(failure);
      const u = tokens.get(token);
      if (!u) throw new AuthError("invalid_token");
      return verified(u);
    },
    statusOf: async (id) => {
      if (id === STATUS_THROWS.id) throw new Error("status lookup down");
      if (id === DEACTIVATED.id) return "deactivated";
      return KNOWN.some((u) => u.id === id) ? "active" : undefined;
    },
    isLiveAdmin: async (id) => (live.get(id) ?? (async () => !!KNOWN.find((u) => u.id === id)?.capabilities.admin))(),
  };
}

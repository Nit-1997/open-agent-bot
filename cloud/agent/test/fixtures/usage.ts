import { RateLimiter } from "@oab/core/lib/rateLimit.js";
import type { ProfileView } from "@oab/shared/admin";
import type { Limits, SignupMode, SignupStats } from "@oab/shared/usage";
import type { DeletingUsers } from "../../src/account/deleting.js";
import type { AdminUsageDeps } from "../../src/limits/adminRoutes.js";
import { humanCheckOff } from "./humanCheck.js";
import { HostedRunPolicy } from "../../src/limits/policy.js";
import type { UsageRouteDeps } from "../../src/limits/routes.js";
import { RunSlots } from "../../src/limits/slots.js";
import { type FakeUsageRepo, FakeUsageStore } from "../limits/fakeUsage.js";

export const TEST_LIMITS: Limits = { runningPerUser: 1, perHour: 10, perMonth: 50, runningServer: 8 };

export type FakeUsageDeps = UsageRouteDeps & { store: FakeUsageStore; usage: FakeUsageRepo; policy: HostedRunPolicy };

export function fakeUsageDeps(
  limiter: RateLimiter = new RateLimiter(),
  limits: Limits = TEST_LIMITS,
  clock?: () => Date,
  deleting?: DeletingUsers,
): FakeUsageDeps {
  const store = new FakeUsageStore(clock);
  const usage = store.repo({ caps: { perMonth: limits.perMonth, perHour: limits.perHour } });
  const slots = new RunSlots({ staleAfterMs: 340_000 });
  const policy = new HostedRunPolicy({ limits, usage, slots, humanCheck: humanCheckOff, limiter, deleting });
  return { store, usage, policy, limits, humanCheck: humanCheckOff, limiter };
}

export function fakeAdminUsageDeps(
  u: FakeUsageDeps,
  profiles: { get(id: string): Promise<ProfileView | undefined> },
  signupMode: () => Promise<SignupMode | "unknown"> = async () => "waitlist",
  signupStats: () => Promise<SignupStats> = async () => ({ lastHour: 0, lastDay: 0, capHour: 20, capDay: 100 }),
): AdminUsageDeps {
  return { usage: u.usage, policy: u.policy, limits: u.limits, profiles, signupMode, signupStats };
}

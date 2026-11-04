import { RateLimiter } from "@oab/core/lib/rateLimit.js";
import type { Limits } from "@oab/shared/usage";
import { humanCheckOff } from "../../src/limits/humanCheckStub.js";
import { HostedRunPolicy } from "../../src/limits/policy.js";
import type { UsageRouteDeps } from "../../src/limits/routes.js";
import { RunSlots } from "../../src/limits/slots.js";
import { FakeUsageStore } from "../limits/fakeUsage.js";

export const TEST_LIMITS: Limits = { runningPerUser: 1, perHour: 10, perMonth: 50, runningServer: 8 };

export function fakeUsageDeps(
  limiter: RateLimiter = new RateLimiter(),
  limits: Limits = TEST_LIMITS,
): UsageRouteDeps & { store: FakeUsageStore } {
  const store = new FakeUsageStore();
  const usage = store.repo({ caps: { perMonth: limits.perMonth, perHour: limits.perHour } });
  const policy = new HostedRunPolicy({ limits, usage, slots: new RunSlots({ staleAfterMs: 340_000 }), humanCheck: humanCheckOff, limiter });
  return { store, usage, policy, limits, humanCheck: humanCheckOff, limiter };
}

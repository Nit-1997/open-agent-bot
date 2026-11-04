import { LocalKeyWrapper } from "@oab/core/secrets/keyWrapper.js";
import type { Identity } from "@oab/core/identity/types.js";
import { BackgroundQueue } from "@oab/core/lib/backgroundQueue.js";
import { log } from "@oab/core/lib/log.js";
import type { RateLimiter } from "@oab/core/lib/rateLimit.js";
import type { AgentDeps, CoreHandles } from "@oab/core/startAgent.js";
import { createAccessService } from "./access/service.js";
import { createAuthAdmin } from "./admin/authAdmin.js";
import { type AccountHooks, createAdminService, createLiveAdminCheck } from "./admin/service.js";
import type { HostedConfig } from "./config.js";
import { hostedGateway } from "./gateway.js";
import { createAdminGuard } from "./identity/adminGuard.js";
import { UserStatusCache } from "./identity/status.js";
import { createSupabaseIdentity } from "./identity/supabaseIdentity.js";
import { createVerifier } from "./identity/verify.js";
import { PRUNE_MS, STALE_GRACE_S, SWEEP_MS } from "./limits/config.js";
import { humanCheckOff } from "./limits/humanCheckStub.js";
import { HostedRunPolicy } from "./limits/policy.js";
import { RunSlots } from "./limits/slots.js";
import { createUsageRepo, type UsageRepo } from "./limits/usageRepo.js";
import { hostedRoutes } from "./routes.js";
import { createAdminRepo } from "./store/admin.js";
import { createAnonClient, createServiceClient, type Db } from "./store/client.js";
import { createSupabaseStore } from "./store/supabaseStore.js";

export type HostedClients = { db: Db; anon: Db };

export const adminHooks = (status: Pick<UserStatusCache, "invalidate">, core: Pick<CoreHandles, "forgetUser">): AccountHooks => ({
  async onDisabled(userId) {
    status.invalidate(userId);
    await core.forgetUser(userId);
  },
  onEnabled(userId) {
    status.invalidate(userId);
  },
});

export type HostedSeams = { identity?: Identity; usage?: UsageRepo };

export type HostedAgent = { deps: AgentDeps; status: UserStatusCache; usage: UsageRepo };

export function startLimitTimers(policy: Pick<HostedRunPolicy, "sweep">, usage: Pick<UsageRepo, "prune">): () => void {
  const timers = [
    setInterval(() => policy.sweep(), SWEEP_MS).unref(),
    setInterval(
      () => void usage.prune().catch((err: unknown) => log.warn("[limits] usage prune failed", err instanceof Error ? err.message : err)),
      PRUNE_MS,
    ).unref(),
  ];
  return () => {
    for (const t of timers) clearInterval(t);
  };
}

export function hostedAgentDeps(
  cfg: HostedConfig,
  clients: HostedClients = { db: createServiceClient(cfg), anon: createAnonClient(cfg) },
  seams: HostedSeams = {},
): HostedAgent {
  const adminRepo = createAdminRepo(clients.db);
  const status = new UserStatusCache((id) => adminRepo.users.status(id));
  const identity = seams.identity ?? createSupabaseIdentity({ serviceSecret: cfg.serviceSecret, verify: createVerifier(cfg), status });
  if (identity.kind !== "hosted") throw new Error(`the hosted agent needs a hosted identity, got "${identity.kind}"`);
  const authAdmin = createAuthAdmin({ service: clients.db, anon: clients.anon, appOrigin: cfg.appOrigin });

  const usage = seams.usage ?? createUsageRepo(clients.db, { caps: { perMonth: cfg.limits.perMonth, perHour: cfg.limits.perHour } });
  const humanCheck = humanCheckOff;
  const slots = new RunSlots({ staleAfterMs: (cfg.runTimeLimitSeconds + STALE_GRACE_S) * 1000 });
  let policy: HostedRunPolicy | undefined;
  const policyFor = (limiter: RateLimiter) => {
    if (!policy) {
      policy = new HostedRunPolicy({ limits: cfg.limits, usage, slots, humanCheck, limiter });
      startLimitTimers(policy, usage);
    }
    return policy;
  };

  const deps: AgentDeps = {
    config: cfg,
    store: createSupabaseStore(clients.db),
    identity,
    keyWrapper: new LocalKeyWrapper(cfg.credentialKeys),
    gateway: hostedGateway(cfg),
    host: "0.0.0.0",
    runPolicy: ({ limiter }) => policyFor(limiter),
    routes: (core) =>
      hostedRoutes({
        access: createAccessService({
          pepper: cfg.accessRequestPepper,
          limiter: core.limiter,
          queue: new BackgroundQueue({ name: "access", max: 200, concurrency: 2 }),
          submit: (input) => adminRepo.accessRequests.submit(input),
          sendMagicLink: async (email) => {
            const r = await authAdmin.magicLink(email);
            return r.ok ? {} : { code: r.code };
          },
        }),
        admin: createAdminService({ repo: adminRepo, auth: authAdmin, hooks: adminHooks(status, core) }),
        adminGuard: createAdminGuard({ isLiveAdmin: createLiveAdminCheck(authAdmin) }),
        limiter: core.limiter,
        usage: { usage, policy: policyFor(core.limiter), limits: cfg.limits, humanCheck, limiter: core.limiter },
      }),
  };
  return { deps, status, usage };
}

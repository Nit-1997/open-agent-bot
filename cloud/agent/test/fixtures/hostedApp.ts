import type { AccessRequestView, ProfileView, UserStatus } from "@oab/shared/admin";
import { PAGE_SIZE } from "@oab/shared/pages";
import type { Principal } from "../../../src/identity/types.js";
import { BackgroundQueue } from "../../../src/lib/backgroundQueue.js";
import { UserError } from "../../../src/lib/errors.js";
import { RateLimiter } from "../../../src/lib/rateLimit.js";
import { type AccessService, createAccessService } from "../../../src/hosted/access/service.js";
import type { AuthAccount, AuthAdmin, EmailResult } from "../../../src/hosted/admin/authAdmin.js";
import { createAdminService } from "../../../src/hosted/admin/service.js";
import { createAdminGuard } from "../../../src/hosted/identity/adminGuard.js";
import { UserStatusCache } from "../../../src/hosted/identity/status.js";
import { createSupabaseIdentity } from "../../../src/hosted/identity/supabaseIdentity.js";
import { AuthError, type Verifier } from "../../../src/hosted/identity/verify.js";
import { hostedRoutes } from "../../../src/hosted/routes.js";
import type { AdminRepo } from "../../../src/hosted/store/admin.js";
import { type AppOverrides, makeApp, tokenFor } from "../../fixtures/app.js";
import { TEST_SECRET } from "./config.js";
import { ADMIN, ALICE, BOB, verified } from "./users.js";

export { tokenFor, wrapper } from "../../fixtures/app.js";

export class FakeAccounts {
  users = new Map<string, { email: string; status: UserStatus; createdAt: string; account: AuthAccount }>();
  requests = new Map<string, AccessRequestView>();
  invited = new Set<string>();
  sent: Array<{ kind: "invite" | "magic"; email: string }> = [];
  failNext?: string;
  removedArtifacts: string[] = [];

  add(u: Principal, status: UserStatus = "active") {
    this.users.set(u.id, {
      email: u.email,
      status,
      createdAt: new Date(1_700_000_000_000 + this.users.size * 1000).toISOString(),
      account: { id: u.id, email: u.email, isAdmin: u.capabilities.admin, bannedUntil: null, lastSignInAt: null, providers: ["email"] },
    });
  }

  profile(id: string): ProfileView | undefined {
    const u = this.users.get(id);
    return u && { id, email: u.email, status: u.status, createdAt: u.createdAt };
  }

  repo(): AdminRepo {
    const self = this;
    const page = <T>(all: T[], n: number) => ({ items: all.slice((n - 1) * PAGE_SIZE, n * PAGE_SIZE), total: all.length });
    return {
      accessRequests: {
        async submit(input) {
          if ([...self.users.values()].some((u) => u.email === input.email)) return "already_member";
          if ([...self.requests.values()].some((r) => r.email === input.email && r.status === "pending")) return "duplicate";
          const id = crypto.randomUUID();
          self.requests.set(id, {
            id,
            name: input.name,
            email: input.email,
            note: input.note,
            status: "pending",
            inviteStatus: null,
            inviteError: null,
            ipHashPrefix: input.ipHash.toString("hex").slice(0, 8),
            createdAt: new Date(1_700_000_000_000 + self.requests.size * 1000).toISOString(),
            decidedAt: null,
          });
          return "inserted";
        },
        async page(filter, n) {
          const all = [...self.requests.values()].filter((r) => filter === "all" || r.status === filter).reverse();
          return page(all, n);
        },
        async get(id) {
          return self.requests.get(id);
        },
        async decide(id, d) {
          const r = self.requests.get(id);
          if (!r) throw new UserError("That request doesn't exist.", "not_found");
          if (r.status !== "pending") throw new UserError("This request was already decided.", "conflict", { code: "already_decided" });
          const next: AccessRequestView = {
            ...r,
            status: d.status,
            decidedAt: new Date().toISOString(),
            ...(d.status === "approved" && { inviteStatus: d.invite?.inviteStatus ?? null, inviteError: d.invite?.inviteError ?? null }),
          };
          self.requests.set(id, next);
          return next;
        },
        async setInvite(id, invite) {
          const r = self.requests.get(id);
          if (!r) throw new UserError("That request doesn't exist.", "not_found");
          const next = { ...r, inviteStatus: invite.inviteStatus, inviteError: invite.inviteError };
          self.requests.set(id, next);
          return next;
        },
        async deleteByEmail(email) {
          for (const [id, r] of self.requests) if (r.email === email) self.requests.delete(id);
        },
      },
      invited: {
        async add(email) {
          self.invited.add(email);
        },
        async remove(email) {
          self.invited.delete(email);
        },
      },
      users: {
        async page(n, q) {
          const all = [...self.users.keys()]
            .map((id) => self.profile(id)!)
            .filter((p) => !q || p.email.startsWith(q))
            .reverse();
          return page(all, n);
        },
        async get(id) {
          return self.profile(id);
        },
        async findByEmail(email) {
          const id = [...self.users.entries()].find(([, u]) => u.email === email)?.[0];
          return id ? self.profile(id) : undefined;
        },
        async status(id) {
          return self.users.get(id)?.status;
        },
        async setStatus(id, status) {
          const u = self.users.get(id);
          if (u) u.status = status;
        },
      },
      storage: {
        async removeUserFiles(userId) {
          self.removedArtifacts.push(userId);
        },
      },
    };
  }

  auth(): AuthAdmin {
    const self = this;
    const result = (): EmailResult => {
      const code = self.failNext;
      self.failNext = undefined;
      return code ? { ok: false, code, message: "failed" } : { ok: true, userId: null };
    };
    return {
      async getUser(id) {
        return self.users.get(id)?.account;
      },
      async invite(email) {
        self.sent.push({ kind: "invite", email });
        return result();
      },
      async magicLink(email) {
        self.sent.push({ kind: "magic", email });
        return result();
      },
      async setBanned(id, banned) {
        const u = self.users.get(id);
        if (u) u.account.bannedUntil = banned ? "2126-01-01T00:00:00Z" : null;
      },
      async deleteUser(id) {
        self.users.delete(id);
      },
    };
  }
}

export type IdentitySeams = {
  verify?: Verifier;
  statusOf?: (id: string) => Promise<UserStatus | undefined>;
  isLiveAdmin?: (u: Principal) => Promise<boolean>;
};

export type HostedOverrides = Omit<AppOverrides, "identity" | "routes"> & { seams?: IdentitySeams; access?: AccessService };

export type HostedHarness = Awaited<ReturnType<typeof makeHostedApp>>;

export async function makeHostedApp(over: HostedOverrides = {}) {
  const { seams, access: accessOver, ...appOver } = over;
  const accounts = new FakeAccounts();
  for (const u of [ALICE, BOB, ADMIN]) accounts.add(u);
  const users = new Map([ALICE, BOB, ADMIN].map((u) => [tokenFor(u), u]));
  const fakeVerify = async (token: string) => {
    const u = users.get(token);
    if (!u) throw new AuthError("invalid_token");
    return verified(u);
  };
  const verify = seams?.verify ?? fakeVerify;
  const status = new UserStatusCache(seams?.statusOf ?? ((id) => accounts.repo().users.status(id)));
  const isLiveAdmin = seams?.isLiveAdmin ?? (async (u: Principal) => !!accounts.users.get(u.id)?.account.isAdmin);
  const identity = createSupabaseIdentity({ serviceSecret: TEST_SECRET, verify, status });
  const limiter = appOver.limiter ?? new RateLimiter();
  const admin = createAdminService({
    repo: accounts.repo(),
    auth: accounts.auth(),
    hooks: { onDisabled: async (id) => status.invalidate(id), onEnabled: (id) => status.invalidate(id) },
  });
  const queue = new BackgroundQueue({ name: "access", max: 50, concurrency: 2 });
  const access = createAccessService({
    pepper: Buffer.alloc(32, 9),
    limiter,
    queue,
    submit: (i) => accounts.repo().accessRequests.submit(i),
    sendMagicLink: async (email) => {
      accounts.sent.push({ kind: "magic", email });
      return {};
    },
  });
  const routes = hostedRoutes({ access: accessOver ?? access, admin, adminGuard: createAdminGuard({ isLiveAdmin }), limiter });
  const h = await makeApp({ ...appOver, limiter, identity, routes });
  return { ...h, accounts, status, queue };
}

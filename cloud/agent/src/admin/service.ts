import type { Principal } from "@oab/core/identity/types.js";
import { UserError } from "@oab/core/lib/errors.js";
import { log } from "@oab/core/lib/log.js";
import type { AccessRequestView, AdminUser, ProfileView, RequestFilter } from "@oab/shared/admin";
import type { Page } from "@oab/shared/pages";
import type { DeletingUsers } from "../account/deleting.js";
import type { UsageRepo } from "../limits/usageRepo.js";
import type { AdminRepo } from "../store/admin.js";
import type { AuthAccount, AuthAdmin, EmailResult } from "./authAdmin.js";
import { deleteAccount } from "./deleteAccount.js";
import { describeInviteFailure } from "./inviteCopy.js";

export type AccountHooks = { onDisabled(userId: string): Promise<void>; onEnabled(userId: string): void };

const missingUser = () => new UserError("That user doesn't exist.", "not_found");
const selfAction = () => new UserError("You can't do that to your own account.", "conflict", { code: "self_action" });
const inviteFailed = (code: string) => new UserError(describeInviteFailure(code), "upstream", { code: "invite_failed" });
const inviteOutcome = (result: EmailResult) =>
  result.ok
    ? { inviteStatus: "sent" as const, inviteError: null }
    : { inviteStatus: "failed" as const, inviteError: describeInviteFailure(result.code) };

export type AdminServiceDeps = {
  repo: AdminRepo;
  auth: AuthAdmin;
  hooks: AccountHooks;
  usage: Pick<UsageRepo, "tombstone">;
  deleting: DeletingUsers;
};

export function createAdminService(deps: AdminServiceDeps) {
  const { repo, auth, hooks, usage, deleting } = deps;

  const request = async (id: string) => {
    const r = await repo.accessRequests.get(id);
    if (!r) throw new UserError("That request doesn't exist.", "not_found");
    return r;
  };

  const userView = (p: ProfileView, a: AuthAccount | undefined): AdminUser => ({
    ...p,
    lastSignInAt: a?.lastSignInAt ?? null,
    providers: a?.providers ?? [],
    isAdmin: a?.isAdmin ?? false,
  });

  const target = async (admin: Principal, id: string): Promise<ProfileView> => {
    if (id === admin.id) throw selfAction();
    const profile = await repo.users.get(id);
    if (!profile) throw missingUser();
    return profile;
  };

  const sendInvite = async (r: AccessRequestView): Promise<{ result: EmailResult; userId: string | null }> => {
    const member = await repo.users.findByEmail(r.email);
    const result = member ? await auth.magicLink(r.email) : await auth.invite(r.email, r.name);
    const userId = member?.id ?? (result.ok ? result.userId : null) ?? (await repo.users.findByEmail(r.email))?.id ?? null;
    if (!result.ok) log.warn(`[admin] invite email failed request=${r.id} code=${result.code} message=${result.message}`);
    return { result, userId };
  };

  const disable = async (id: string) => {
    await auth.setBanned(id, true);
    await repo.users.setStatus(id, "deactivated");
    await hooks.onDisabled(id);
  };

  return {
    listRequests: (filter: RequestFilter, page: number) => repo.accessRequests.page(filter, page),

    async approve(admin: Principal, id: string): Promise<AccessRequestView> {
      const r = await request(id);
      if (r.status !== "pending") throw new UserError("This request was already decided.", "conflict", { code: "already_decided" });
      const member = await repo.users.findByEmail(r.email);
      if (member) return repo.accessRequests.decide(id, { status: "approved", decidedBy: admin.id, userId: member.id, invite: null });
      await repo.invited.add(r.email, r.id, admin.id);
      const { result, userId } = await sendInvite(r);
      const updated = await repo.accessRequests.decide(id, {
        status: "approved",
        decidedBy: admin.id,
        userId,
        invite: inviteOutcome(result),
      });
      if (!result.ok) throw inviteFailed(result.code);
      return updated;
    },

    async reject(admin: Principal, id: string): Promise<AccessRequestView> {
      const r = await request(id);
      if (r.status !== "pending") throw new UserError("This request was already decided.", "conflict", { code: "already_decided" });
      return repo.accessRequests.decide(id, { status: "rejected", decidedBy: admin.id });
    },

    async resend(_admin: Principal, id: string): Promise<AccessRequestView> {
      const r = await request(id);
      if (r.status !== "approved")
        throw new UserError("Only approved requests can get a new invite.", "conflict", { code: "not_approved" });
      await repo.invited.add(r.email, r.id, null);
      const { result, userId } = await sendInvite(r);
      const updated = await repo.accessRequests.setInvite(id, inviteOutcome(result), userId);
      if (!result.ok) throw inviteFailed(result.code);
      return updated;
    },

    async listUsers(page: number, q?: string): Promise<Page<AdminUser>> {
      const profiles = await repo.users.page(page, q);
      const accounts = await Promise.all(profiles.items.map((p) => auth.getUser(p.id)));
      return { items: profiles.items.map((p, i) => userView(p, accounts[i])), total: profiles.total };
    },

    async deactivate(admin: Principal, id: string): Promise<AdminUser> {
      await target(admin, id);
      await disable(id);
      return userView((await repo.users.get(id))!, await auth.getUser(id));
    },

    async reactivate(admin: Principal, id: string): Promise<AdminUser> {
      await target(admin, id);
      await auth.setBanned(id, false);
      await repo.users.setStatus(id, "active");
      hooks.onEnabled(id);
      return userView((await repo.users.get(id))!, await auth.getUser(id));
    },

    async remove(admin: Principal, id: string, confirmEmail: unknown): Promise<void> {
      const profile = await target(admin, id);
      if (typeof confirmEmail !== "string" || confirmEmail.trim().toLowerCase() !== profile.email)
        throw new UserError("Type the user's email to confirm.", "unprocessable");
      const step = async (name: string, fn: () => Promise<void>) => {
        try {
          await fn();
        } catch (err) {
          log.error(`[admin] delete user=${id} failed at ${name}`, err instanceof UserError ? err.kind : err);
          throw new UserError("Deleting the user failed. Try again; finished steps are skipped.", "internal", {
            code: "delete_failed",
            details: { step: name },
          });
        }
      };
      deleting.add(id);
      try {
        await step("deactivate", () => disable(id));
        await deleteAccount({ repo, auth, usage }, profile, step);
      } catch (err) {
        deleting.delete(id);
        throw err;
      }
      log.info(`[admin] deleted user=${id} by=${admin.id}`);
    },
  };
}

export type AdminService = ReturnType<typeof createAdminService>;

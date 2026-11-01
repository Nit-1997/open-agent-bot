import type { AuthUser } from "../auth/verify.js";
import type { AccessRequestView, AdminRepo, ProfileView, RequestFilter } from "../db/admin.js";
import type { Page } from "../db/types.js";
import { UserError } from "../lib/errors.js";
import { log } from "../lib/log.js";
import type { AuthAccount, AuthAdmin, EmailResult } from "./authAdmin.js";

export type UserView = ProfileView & { lastSignInAt: string | null; providers: string[]; isAdmin: boolean };

export type AccountHooks = { onDisabled(userId: string): Promise<void>; onEnabled(userId: string): void };

const ADMIN_TTL_MS = 30_000;

const missingUser = () => new UserError("That user doesn't exist.", "not_found");
const selfAction = () => new UserError("You can't do that to your own account.", "conflict", { code: "self_action" });
const inviteFailed = (code: string) =>
  new UserError(`Invite email failed: ${code}. Use Resend invite.`, "upstream", { code: "invite_failed" });

export function createLiveAdminCheck(auth: Pick<AuthAdmin, "getUser">, now: () => number = Date.now) {
  const cache = new Map<string, { ok: boolean; at: number }>();
  return async (user: AuthUser): Promise<boolean> => {
    const hit = cache.get(user.id);
    if (hit && now() - hit.at < ADMIN_TTL_MS) return hit.ok;
    const account = await auth.getUser(user.id);
    const ok = !!account?.isAdmin && (!account.bannedUntil || Date.parse(account.bannedUntil) <= now());
    cache.set(user.id, { ok, at: now() });
    return ok;
  };
}

export function createAdminService(deps: { repo: AdminRepo; auth: AuthAdmin; hooks: AccountHooks }) {
  const { repo, auth, hooks } = deps;

  const request = async (id: string) => {
    const r = await repo.accessRequests.get(id);
    if (!r) throw new UserError("That request doesn't exist.", "not_found");
    return r;
  };

  const userView = (p: ProfileView, a: AuthAccount | undefined): UserView => ({
    ...p,
    lastSignInAt: a?.lastSignInAt ?? null,
    providers: a?.providers ?? [],
    isAdmin: a?.isAdmin ?? false,
  });

  const target = async (admin: AuthUser, id: string): Promise<ProfileView> => {
    if (id === admin.id) throw selfAction();
    const profile = await repo.users.get(id);
    if (!profile) throw missingUser();
    return profile;
  };

  const sendInvite = async (r: AccessRequestView): Promise<{ result: EmailResult; userId: string | null }> => {
    const member = await repo.users.findByEmail(r.email);
    const result = member ? await auth.magicLink(r.email) : await auth.invite(r.email, r.name);
    const userId = member?.id ?? (result.ok ? result.userId : null) ?? (await repo.users.findByEmail(r.email))?.id ?? null;
    if (!result.ok) log.warn(`[admin] invite email failed request=${r.id} code=${result.code}`);
    return { result, userId };
  };

  const disable = async (id: string) => {
    await auth.setBanned(id, true);
    await repo.users.setStatus(id, "deactivated");
    await hooks.onDisabled(id);
  };

  return {
    listRequests: (filter: RequestFilter, page: number) => repo.accessRequests.page(filter, page),

    async approve(admin: AuthUser, id: string): Promise<AccessRequestView> {
      const r = await request(id);
      if (r.status !== "pending") throw new UserError("This request was already decided.", "conflict", { code: "already_decided" });
      const member = await repo.users.findByEmail(r.email);
      if (member) {
        await repo.accessRequests.decide(id, { status: "approved", decidedBy: admin.id, userId: member.id, invite: null });
        throw new UserError("This email already has an account.", "conflict", { code: "already_member" });
      }
      await repo.invited.add(r.email, r.id, admin.id);
      const { result, userId } = await sendInvite(r);
      const invite = result.ok
        ? { inviteStatus: "sent" as const, inviteError: null }
        : { inviteStatus: "failed" as const, inviteError: `${result.code}: ${result.message}` };
      const updated = await repo.accessRequests.decide(id, { status: "approved", decidedBy: admin.id, userId, invite });
      if (!result.ok) throw inviteFailed(result.code);
      return updated;
    },

    async reject(admin: AuthUser, id: string): Promise<AccessRequestView> {
      const r = await request(id);
      if (r.status !== "pending") throw new UserError("This request was already decided.", "conflict", { code: "already_decided" });
      return repo.accessRequests.decide(id, { status: "rejected", decidedBy: admin.id });
    },

    async resend(_admin: AuthUser, id: string): Promise<AccessRequestView> {
      const r = await request(id);
      if (r.status !== "approved")
        throw new UserError("Only approved requests can get a new invite.", "conflict", { code: "not_approved" });
      await repo.invited.add(r.email, r.id, null);
      const { result, userId } = await sendInvite(r);
      const updated = await repo.accessRequests.setInvite(
        id,
        result.ok
          ? { inviteStatus: "sent", inviteError: null }
          : { inviteStatus: "failed", inviteError: `${result.code}: ${result.message}` },
        userId,
      );
      if (!result.ok) throw inviteFailed(result.code);
      return updated;
    },

    async listUsers(page: number, q?: string): Promise<Page<UserView>> {
      const profiles = await repo.users.page(page, q);
      const accounts = await Promise.all(profiles.items.map((p) => auth.getUser(p.id)));
      return { items: profiles.items.map((p, i) => userView(p, accounts[i])), total: profiles.total };
    },

    async deactivate(admin: AuthUser, id: string): Promise<UserView> {
      await target(admin, id);
      await disable(id);
      return userView((await repo.users.get(id))!, await auth.getUser(id));
    },

    async reactivate(admin: AuthUser, id: string): Promise<UserView> {
      await target(admin, id);
      await auth.setBanned(id, false);
      await repo.users.setStatus(id, "active");
      hooks.onEnabled(id);
      return userView((await repo.users.get(id))!, await auth.getUser(id));
    },

    async remove(admin: AuthUser, id: string, confirmEmail: unknown): Promise<void> {
      const profile = await target(admin, id);
      if (typeof confirmEmail !== "string" || confirmEmail.trim().toLowerCase() !== profile.email)
        throw new UserError("Type the user's email to confirm.", "unprocessable");
      const step = async (name: "deactivate" | "storage" | "requests" | "auth_user", fn: () => Promise<void>) => {
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
      await step("deactivate", () => disable(id));
      await step("storage", () => auth.removeArtifacts(id));
      await step("requests", async () => {
        await repo.accessRequests.deleteByEmail(profile.email);
        await repo.invited.remove(profile.email);
      });
      await step("auth_user", () => auth.deleteUser(id));
      log.info(`[admin] deleted user=${id} by=${admin.id}`);
    },
  };
}

export type AdminService = ReturnType<typeof createAdminService>;

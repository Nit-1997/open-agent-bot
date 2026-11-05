import type { Principal } from "@oab/core/identity/types.js";
import { UserError } from "@oab/core/lib/errors.js";
import { log } from "@oab/core/lib/log.js";
import type { AuthAdmin } from "../admin/authAdmin.js";
import { type AccountRemoval, deleteAccount, type StepRunner } from "../admin/deleteAccount.js";
import type { AdminRepo } from "../store/admin.js";
import type { DeletingUsers } from "./deleting.js";

export const SELF_DELETE_MESSAGES = {
  confirm: "Type your email to confirm.",
  missing: "That account doesn't exist.",
  admin: "Admins can't delete their own account here. Ask another admin to remove the admin role first.",
  failed: "Deleting your account failed. Try again; finished steps are skipped.",
} as const;

export type SelfDeleteDeps = {
  profiles: Pick<AdminRepo["users"], "get">;
  removal: AccountRemoval & { auth: Pick<AuthAdmin, "getUser" | "deleteUser"> };
  deleting: DeletingUsers;
  forget(userId: string): Promise<void>;
  invalidate(userId: string): void;
};

export type SelfDelete = (user: Principal, confirmEmail: unknown) => Promise<void>;

async function inStep(userId: string, step: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    log.error(`[account] self-delete user=${userId} failed at ${step}`, err instanceof UserError ? err.kind : err);
    throw new UserError(SELF_DELETE_MESSAGES.failed, "internal", { code: "delete_failed", details: { step } });
  }
}

export function createSelfDelete(deps: SelfDeleteDeps): SelfDelete {
  return async (user, confirmEmail) => {
    const profile = await deps.profiles.get(user.id);
    if (!profile) throw new UserError(SELF_DELETE_MESSAGES.missing, "not_found");
    if (typeof confirmEmail !== "string" || confirmEmail.trim().toLowerCase() !== profile.email.toLowerCase())
      throw new UserError(SELF_DELETE_MESSAGES.confirm, "unprocessable", { code: "confirm_email" });
    if (user.capabilities.admin || (await deps.removal.auth.getUser(user.id))?.isAdmin)
      throw new UserError(SELF_DELETE_MESSAGES.admin, "conflict", { code: "admin_self_delete" });

    deps.deleting.add(user.id);
    const step: StepRunner = (name, fn) => inStep(user.id, name, fn);
    try {
      await inStep(user.id, "sessions", () => deps.forget(user.id));
      await deleteAccount(deps.removal, { id: user.id, email: profile.email }, step);
    } catch (err) {
      deps.deleting.delete(user.id);
      throw err;
    }
    deps.invalidate(user.id);
    log.info(`[account] deleted user=${user.id} (self-serve)`);
  };
}

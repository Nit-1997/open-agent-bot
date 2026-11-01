import type { AdminRepo } from "../db/admin.js";
import type { AuthAdmin } from "./authAdmin.js";

export const DELETE_STEPS = ["storage", "requests", "auth_user"] as const;
export type DeleteStep = (typeof DELETE_STEPS)[number];

export type AccountRemoval = { repo: Pick<AdminRepo, "storage" | "accessRequests" | "invited">; auth: Pick<AuthAdmin, "deleteUser"> };
export type StepRunner = (step: DeleteStep, fn: () => Promise<void>) => Promise<void>;

const direct: StepRunner = (_step, fn) => fn();

export async function deleteAccount(deps: AccountRemoval, account: { id: string; email: string }, run: StepRunner = direct): Promise<void> {
  await run("storage", () => deps.repo.storage.removeUserFiles(account.id));
  await run("requests", async () => {
    await deps.repo.accessRequests.deleteByEmail(account.email);
    await deps.repo.invited.remove(account.email);
  });
  await run("auth_user", () => deps.auth.deleteUser(account.id));
}

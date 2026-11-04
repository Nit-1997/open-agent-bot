import type { UsageRepo } from "../limits/usageRepo.js";
import type { AdminRepo } from "../store/admin.js";
import type { AuthAdmin } from "./authAdmin.js";

export const DELETE_STEPS = ["usage", "storage", "requests", "auth_user"] as const;
export type DeleteStep = (typeof DELETE_STEPS)[number];

export type AccountRemoval = {
  repo: Pick<AdminRepo, "storage" | "accessRequests" | "invited">;
  auth: Pick<AuthAdmin, "deleteUser">;
  usage: Pick<UsageRepo, "tombstone">;
};
export type StepRunner = (step: DeleteStep, fn: () => Promise<void>) => Promise<void>;

const direct: StepRunner = (_step, fn) => fn();

export async function deleteAccount(deps: AccountRemoval, account: { id: string; email: string }, run: StepRunner = direct): Promise<void> {
  await run("usage", () => deps.usage.tombstone(account.id));
  await run("storage", () => deps.repo.storage.removeUserFiles(account.id));
  await run("requests", async () => {
    await deps.repo.accessRequests.deleteByEmail(account.email);
    await deps.repo.invited.remove(account.email);
  });
  await run("auth_user", () => deps.auth.deleteUser(account.id));
}

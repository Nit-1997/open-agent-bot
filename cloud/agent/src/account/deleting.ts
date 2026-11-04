import { UserError } from "@oab/core/lib/errors.js";

export const DELETING_MAX = 10_000;

export const accountDeleting = () => new UserError("This account is being deleted.", "forbidden", { code: "account_disabled" });

export class DeletingUsers {
  private readonly ids = new Set<string>();

  add(userId: string): void {
    this.ids.delete(userId);
    this.ids.add(userId);
    if (this.ids.size > DELETING_MAX) this.ids.delete(this.ids.values().next().value!);
  }

  delete(userId: string): void {
    this.ids.delete(userId);
  }

  has(userId: string): boolean {
    return this.ids.has(userId);
  }
}

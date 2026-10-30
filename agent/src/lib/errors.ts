export type UserErrorKind = "invalid" | "not_found" | "conflict" | "upstream" | "unavailable";

export class UserError extends Error {
  constructor(
    message: string,
    readonly kind: UserErrorKind = "invalid",
  ) {
    super(message);
    this.name = "UserError";
  }
}

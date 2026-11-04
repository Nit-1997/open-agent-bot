export type UserErrorKind =
  | "invalid"
  | "unprocessable"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "too_large"
  | "rate_limited"
  | "upstream"
  | "unavailable"
  | "internal";

export type UserErrorOptions = { code?: string; retryAfter?: number; details?: Record<string, string | number> };

export class UserError extends Error {
  constructor(
    message: string,
    readonly kind: UserErrorKind = "invalid",
    readonly opts: UserErrorOptions = {},
  ) {
    super(message);
    this.name = "UserError";
  }

  get code(): string {
    return this.opts.code ?? (this.kind === "unprocessable" ? "invalid" : this.kind);
  }
}

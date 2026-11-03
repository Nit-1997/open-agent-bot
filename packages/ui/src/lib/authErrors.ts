export const AUTH_ERROR_COPY = {
  not_invited: "This Google account isn't invited. Use the email you were invited with, or request access.",
  link_expired: "That link has expired or was already used. Sign in with Google, or ask for a new link below.",
  link_mismatch: "That link was for a different account, so you weren't signed in. Ask for a new link below.",
  auth_failed: "Sign-in didn't work. Try again.",
  signed_out: "You were signed out. Sign in again.",
  account_disabled: "Your access has been turned off.",
  auth_unavailable: "Can't reach the account service. Try again in a minute.",
} as const;

export type AuthErrorCode = keyof typeof AUTH_ERROR_COPY;

export function authErrorCopy(code: unknown): string | null {
  return typeof code === "string" && Object.hasOwn(AUTH_ERROR_COPY, code) ? AUTH_ERROR_COPY[code as AuthErrorCode] : null;
}

export function callbackErrorCode(params: URLSearchParams): AuthErrorCode | null {
  const error = params.get("error");
  const errorCode = params.get("error_code");
  if (!error && !errorCode) return null;
  const description = params.get("error_description") ?? "";
  if (errorCode === "signup_disabled" || error === "signup_disabled" || /invite-only/i.test(description)) return "not_invited";
  return "auth_failed";
}

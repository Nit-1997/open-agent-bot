import { log } from "@oab/core/lib/log.js";

export type HumanAction = "human_check" | "email_link";
export type VerifyOutcome = "ok" | "failed" | "unavailable";

export interface HumanVerifier {
  verify(token: unknown, opts: { action: HumanAction; remoteIp?: string }): Promise<VerifyOutcome>;
}

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const TEST_SECRET_RE = /^[0-9]x0{30,}[A-Z]{2}$/;
export const TEST_SITE_KEY_RE = /^[0-9]x0{20}[A-Z]{2}$/;
export const TEST_RESPONSE_HOSTNAME = "example.com";
export const VERIFY_TIMEOUT_MS = 5000;
export const TOKEN_MAX = 2048;

const IP_RE = /^[0-9A-Fa-f:.]{2,45}$/;

export const isTestSecret = (secret: string) => TEST_SECRET_RE.test(secret);

export type TurnstileOptions = {
  secret: string;
  hostname: string;
  verifyUrl?: string;
  allowTestResponse?: boolean;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

type SiteVerify = {
  success?: unknown;
  hostname?: unknown;
  action?: unknown;
  "error-codes"?: unknown;
  metadata?: { result_with_testing_key?: unknown };
};

const codesOf = (body: SiteVerify) =>
  Array.isArray(body["error-codes"]) ? body["error-codes"].filter((c): c is string => typeof c === "string").join(",") : "";

function isRecordedTestResponse(body: SiteVerify): boolean {
  return body.metadata?.result_with_testing_key === true && body.hostname === TEST_RESPONSE_HOSTNAME && body.action === undefined;
}

export function createTurnstileVerifier(opts: TurnstileOptions): HumanVerifier {
  const verifyUrl = opts.verifyUrl ?? TURNSTILE_VERIFY_URL;
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? VERIFY_TIMEOUT_MS;
  const allowTest = opts.allowTestResponse === true && isTestSecret(opts.secret);

  return {
    async verify(token, { action, remoteIp }) {
      if (typeof token !== "string" || token.length < 1 || token.length > TOKEN_MAX) {
        log.warn(`[captcha] ${action} refused reason=no_token`);
        return "failed";
      }
      const form = new URLSearchParams({ secret: opts.secret, response: token });
      if (remoteIp && IP_RE.test(remoteIp)) form.set("remoteip", remoteIp);
      let body: SiteVerify;
      try {
        const res = await doFetch(verifyUrl, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: form.toString(),
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          await res.body?.cancel().catch(() => {});
          log.warn(`[captcha] ${action} unavailable status=${res.status}`);
          return "unavailable";
        }
        body = (await res.json()) as SiteVerify;
      } catch (err) {
        log.warn(`[captcha] ${action} unavailable`, err instanceof Error ? err.name : "error");
        return "unavailable";
      }
      if (!body || typeof body !== "object") return "unavailable";
      if (body.success !== true) {
        log.info(`[captcha] ${action} failed codes=${codesOf(body) || "none"}`);
        return "failed";
      }
      if (allowTest && isRecordedTestResponse(body)) return "ok";
      if (body.hostname !== opts.hostname) {
        log.warn(`[captcha] ${action} failed reason=hostname`);
        return "failed";
      }
      if (body.action !== action) {
        log.warn(`[captcha] ${action} failed reason=action`);
        return "failed";
      }
      return "ok";
    },
  };
}

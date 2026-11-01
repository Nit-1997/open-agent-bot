import { createHash, createHmac } from "node:crypto";
import { normalizeEmail as parseEmail } from "../../../shared/email.js";
import type { SubmitOutcome } from "../db/admin.js";
import type { BackgroundQueue } from "../lib/backgroundQueue.js";
import { UserError } from "../lib/errors.js";
import { ipKey } from "../lib/ipKey.js";
import { log } from "../lib/log.js";
import { LIMITS, type RateLimiter } from "../lib/rateLimit.js";

export type AccessDeps = {
  pepper: Buffer;
  limiter: RateLimiter;
  queue: BackgroundQueue;
  submit: (input: { name: string; email: string; note: string; ipHash: Buffer }) => Promise<SubmitOutcome>;
  sendMagicLink: (email: string) => Promise<{ code?: string }>;
  now?: () => number;
};

export const FORM_TOKEN_TTL_MS = 60 * 60_000;
const MAX_TOKENS = 20_000;

export const hashIp = (pepper: Buffer, ip: string) => createHmac("sha256", pepper).update(ipKey(ip), "utf8").digest();

export function normalizeEmail(raw: unknown): string {
  const email = parseEmail(raw);
  if (!email) throw new UserError("Enter a valid email address.", "invalid");
  return email;
}

export function readRequest(b: Record<string, unknown>): { name: string; email: string; note: string; formToken: string } {
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name || name.length > 100) throw new UserError("Enter your name (up to 100 characters).", "invalid");
  const note = typeof b.note === "string" ? b.note.trim() : "";
  if (note.length > 1000) throw new UserError("The note can be up to 1000 characters.", "invalid");
  const formToken = typeof b.formToken === "string" ? b.formToken : "";
  if (!formToken || formToken.length > 200) throw new UserError("The form expired. Reload the page and try again.", "invalid");
  return { name, email: normalizeEmail(b.email), note, formToken };
}

class SeenTokens {
  private readonly seen = new Map<string, number>();

  constructor(private readonly now: () => number) {}

  firstUse(token: string): boolean {
    const now = this.now();
    for (const [t, at] of this.seen) {
      if (now - at < FORM_TOKEN_TTL_MS && this.seen.size <= MAX_TOKENS) break;
      this.seen.delete(t);
    }
    if (this.seen.has(token)) return false;
    this.seen.set(token, now);
    return true;
  }
}

export function createAccessService(deps: AccessDeps) {
  const tokens = new SeenTokens(deps.now ?? Date.now);
  const tagOf = (ipHash: Buffer) => ipHash.toString("hex").slice(0, 8);

  return {
    request(input: { name: string; email: string; note: string; formToken: string }, ip: string): void {
      const ipHash = hashIp(deps.pepper, ip);
      const tag = tagOf(ipHash);
      if (!tokens.firstUse(input.formToken)) {
        log.warn(`[access] request replayed_form ip=${tag}`);
        return;
      }
      const { formToken: _used, ...fields } = input;
      deps.queue.push(async () => {
        try {
          const outcome = await deps.submit({ ...fields, ipHash });
          if (outcome.startsWith("rate_limited")) log.warn(`[access] request ${outcome} ip=${tag}`);
          else log.info(`[access] request ${outcome} ip=${tag}`);
        } catch (err) {
          log.warn(`[access] request failed ip=${tag}`, err instanceof UserError ? err.kind : "error");
        }
      });
    },

    emailLink(email: string, ip: string): void {
      const ipHash = hashIp(deps.pepper, ip);
      const tag = tagOf(ipHash);
      const ipHex = ipHash.toString("hex");
      const addr = createHash("sha256").update(email, "utf8").digest("hex");
      if (!deps.limiter.take(`email-link-ip:${ipHex}`, LIMITS.emailLinkIp).ok) {
        log.warn(`[access] email link rate_limited_ip ip=${tag}`);
        return;
      }
      if (!deps.limiter.take(`email-link-addr:${addr}:${ipHex}`, LIMITS.emailLinkAddr).ok) {
        log.warn(`[access] email link rate_limited_addr ip=${tag}`);
        return;
      }
      deps.queue.push(async () => {
        try {
          const { code } = await deps.sendMagicLink(email);
          log.info(`[access] email link ${code ? `not sent code=${code}` : "sent"} ip=${tag}`);
        } catch {
          log.info(`[access] email link not sent code=unreachable ip=${tag}`);
        }
      });
    },
  };
}

export type AccessService = ReturnType<typeof createAccessService>;

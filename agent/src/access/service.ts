import { createHash, createHmac } from "node:crypto";
import type { SubmitOutcome } from "../db/admin.js";
import { UserError } from "../lib/errors.js";
import { log } from "../lib/log.js";
import { LIMITS, type RateLimiter } from "../lib/rateLimit.js";

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const RESPONSE_FLOOR_MS = 300;

export type AccessDeps = {
  pepper: Buffer;
  limiter: RateLimiter;
  submit: (input: { name: string; email: string; note: string; ipHash: Buffer }) => Promise<SubmitOutcome>;
  sendMagicLink: (email: string) => Promise<{ code?: string }>;
};

export const hashIp = (pepper: Buffer, ip: string) => createHmac("sha256", pepper).update(ip, "utf8").digest();

export function normalizeEmail(raw: unknown): string {
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) throw new UserError("Enter a valid email address.", "invalid");
  return email;
}

export function readRequest(b: Record<string, unknown>): { name: string; email: string; note: string } {
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name || name.length > 100) throw new UserError("Enter your name (up to 100 characters).", "invalid");
  const note = typeof b.note === "string" ? b.note.trim() : "";
  if (note.length > 1000) throw new UserError("The note can be up to 1000 characters.", "invalid");
  return { name, email: normalizeEmail(b.email), note };
}

export async function padTo<T>(floorMs: number, work: () => Promise<T>, now: () => number = Date.now): Promise<T> {
  const started = now();
  try {
    return await work();
  } finally {
    const left = floorMs - (now() - started);
    if (left > 0) await new Promise((r) => setTimeout(r, left));
  }
}

export function createAccessService(deps: AccessDeps) {
  return {
    async request(input: { name: string; email: string; note: string }, ip: string): Promise<void> {
      const ipHash = hashIp(deps.pepper, ip);
      const tag = ipHash.toString("hex").slice(0, 8);
      try {
        const outcome = await deps.submit({ ...input, ipHash });
        if (outcome.startsWith("rate_limited")) log.warn(`[access] request ${outcome} ip=${tag}`);
        else log.info(`[access] request ${outcome} ip=${tag}`);
      } catch (err) {
        log.warn(`[access] request failed ip=${tag}`, err instanceof UserError ? err.kind : "error");
      }
    },

    async emailLink(email: string, ip: string): Promise<void> {
      const ipHash = hashIp(deps.pepper, ip);
      const tag = ipHash.toString("hex").slice(0, 8);
      const addr = createHash("sha256").update(email, "utf8").digest("hex");
      if (!deps.limiter.take(`email-link-ip:${ipHash.toString("hex")}`, LIMITS.emailLinkIp).ok) {
        log.warn(`[access] email link rate_limited_ip ip=${tag}`);
        return;
      }
      if (!deps.limiter.take(`email-link-addr:${addr}`, LIMITS.emailLinkAddr).ok) {
        log.warn(`[access] email link rate_limited_addr ip=${tag}`);
        return;
      }
      try {
        const { code } = await deps.sendMagicLink(email);
        log.info(`[access] email link ${code ? `not sent code=${code}` : "sent"} ip=${tag}`);
      } catch {
        log.info(`[access] email link not sent code=unreachable ip=${tag}`);
      }
    },
  };
}

export type AccessService = ReturnType<typeof createAccessService>;

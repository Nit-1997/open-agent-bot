import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { serviceSecret } from "@/lib/env";

const MIN_AGE_MS = 3_000;
const MAX_AGE_MS = 60 * 60 * 1000;

const formKey = (secret: string) => createHash("sha256").update(`oab/form-ts/v1\0${secret}`).digest();
const mac = (ts: string, secret: string) => createHmac("sha256", formKey(secret)).update(ts).digest("base64url");

export function signFormTs(now: number = Date.now(), secret: string = serviceSecret()): string {
  const ts = String(now);
  return `${ts}.${mac(ts, secret)}`;
}

export const freshFormTs = (now: number = Date.now()): string => signFormTs(now - MIN_AGE_MS);

export type FormTsProblem = "malformed" | "bad_signature" | "too_fast" | "expired";

export function formTsProblem(token: unknown, now: number = Date.now(), secret: string = serviceSecret()): FormTsProblem | null {
  if (typeof token !== "string" || token.length > 200) return "malformed";
  const match = /^(\d{1,16})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return "malformed";
  const [, ts, sig] = match;
  const expected = Buffer.from(mac(ts, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "bad_signature";
  const age = now - Number(ts);
  if (age < MIN_AGE_MS) return "too_fast";
  return age > MAX_AGE_MS ? "expired" : null;
}

export const checkFormTs = (token: unknown, now: number = Date.now(), secret: string = serviceSecret()): boolean =>
  formTsProblem(token, now, secret) === null;

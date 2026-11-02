import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { serviceSecret } from "@/lib/env";

export const NEXT_COOKIE = "oab_next";
export const LINK_COOKIE = "oab_link";
export const LINK_COOKIE_MAX_AGE = 60 * 60;

const linkKey = (secret: string) => createHash("sha256").update(`oab/email-link/v1\0${secret}`).digest();

export function linkBinding(email: string, secret: string = serviceSecret()): string {
  return createHmac("sha256", linkKey(secret)).update(email).digest("base64url");
}

export function isBoundTo(cookie: string | undefined, email: string, secret: string = serviceSecret()): boolean {
  if (!cookie) return false;
  const expected = Buffer.from(linkBinding(email, secret));
  const given = Buffer.from(cookie);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

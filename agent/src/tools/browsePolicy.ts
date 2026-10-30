import { publicHttpUrlError } from "./net.js";

export type BrowseAction =
  | { op: "goto"; url: string }
  | { op: "click"; selector?: string; text?: string }
  | { op: "type"; selector: string; value: string; submit?: boolean }
  | { op: "select"; selector: string; value: string }
  | { op: "wait"; ms: number }
  | { op: "read" };

export type TargetInfo = { type?: string; name?: string; autocomplete?: string; text?: string };

type PolicyOptions = { allowPrivateHosts?: boolean };

type PolicyResult = { allowed: true } | { allowed: false; reason: string };

export const BOT_WALL =
  /(robot or human|are you a robot|captcha|access denied|unusual traffic|verify you are human|press and hold|sorry! something went wrong)/i;

const BLOCKED_URL_WORDS =
  /(?:^|[^a-z0-9])(?:checkout|cart|basket|payment|payments|pay|billing|login|signin|sign-in|signup|sign-up|register|account|accounts|auth|oauth|wallet|book|booking|bookings|reserve|reservation|reservations|order|orders|purchase|passenger|passengers|traveler|travelers|traveller|travellers|guest-details)(?:[^a-z0-9]|$)/i;

const BLOCKED_TARGET_TEXT =
  /(place (your )?order|buy now|\bpay\b|pay now|add to (cart|bag|basket)|proceed to (checkout|pay)|\bcheckout\b|sign in|log ?in|sign up|book now|confirm booking|reserve now|complete booking)/i;

const BLOCKED_AUTOCOMPLETE = /cc-|current-password|new-password|one-time-code|name|email|tel|street-address|address-line|bday|username/i;
const BLOCKED_INPUT_TYPES = new Set(["password", "email", "tel"]);

function subdomains(hostname: string): string {
  const labels = hostname.toLowerCase().split(".");
  const suffix = labels.length > 2 && labels.at(-2)!.length <= 3 && labels.at(-1)!.length === 2 ? 3 : 2;
  return labels.slice(0, -suffix).join(".");
}

export function isBlockedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return BLOCKED_URL_WORDS.test(`${subdomains(u.hostname)}/${u.pathname}`);
  } catch {
    return false;
  }
}

export function checkAction(a: BrowseAction, page: { url: string; target?: TargetInfo }, opts: PolicyOptions = {}): PolicyResult {
  if (a.op === "goto") {
    const err = publicHttpUrlError(a.url, opts);
    if (err) return { allowed: false, reason: err };
  }
  if (isBlockedUrl(page.url)) {
    return { allowed: false, reason: "current page is a login, cart, account, or payment page" };
  }
  if (a.op === "goto" && isBlockedUrl(a.url)) {
    return { allowed: false, reason: "that link goes to a login, cart, checkout, or payment page" };
  }
  const t = page.target;
  if (t) {
    if (a.op === "type" && t.type && BLOCKED_INPUT_TYPES.has(t.type.toLowerCase())) {
      return { allowed: false, reason: "won't type passwords, emails, or phone numbers" };
    }
    if (a.op === "type" && t.autocomplete && BLOCKED_AUTOCOMPLETE.test(t.autocomplete)) {
      return { allowed: false, reason: "won't fill payment, credential, or personal-detail fields" };
    }
    const label = [t.text, t.name].filter(Boolean).join(" ");
    if ((a.op === "click" || (a.op === "type" && a.submit)) && BLOCKED_TARGET_TEXT.test(label)) {
      return { allowed: false, reason: `"${(t.text ?? t.name ?? "").trim().slice(0, 60)}" is a purchase, booking, or sign-in step` };
    }
  }
  return { allowed: true };
}

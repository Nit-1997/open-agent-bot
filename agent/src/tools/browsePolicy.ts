export type BrowseAction =
  | { op: "goto"; url: string }
  | { op: "click"; selector?: string; text?: string }
  | { op: "type"; selector: string; value: string; submit?: boolean }
  | { op: "select"; selector: string; value: string }
  | { op: "wait"; ms: number }
  | { op: "read" };

export type TargetInfo = { type?: string; name?: string; autocomplete?: string; text?: string };

export type PolicyResult = { allowed: true } | { allowed: false; reason: string };

const BLOCKED_URL_WORDS =
  /(?:^|[^a-z0-9])(?:checkout|cart|basket|payment|payments|pay|billing|login|signin|sign-in|signup|sign-up|register|account|accounts|auth|oauth|wallet)(?:[^a-z0-9]|$)/i;

const BLOCKED_TARGET_TEXT =
  /(place (your )?order|buy now|\bpay\b|pay now|add to (cart|bag|basket)|proceed to (checkout|pay)|\bcheckout\b|sign in|log ?in|sign up|book now|confirm booking|reserve now|complete booking)/i;

const BLOCKED_AUTOCOMPLETE = /cc-|current-password|new-password|one-time-code/i;

export function isBlockedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return BLOCKED_URL_WORDS.test(`${u.hostname}${u.pathname}`);
  } catch {
    return false;
  }
}

export function checkAction(a: BrowseAction, page: { url: string; target?: TargetInfo }): PolicyResult {
  if (isBlockedUrl(page.url)) {
    return { allowed: false, reason: "current page is a login, cart, account, or payment page" };
  }
  if (a.op === "goto" && isBlockedUrl(a.url)) {
    return { allowed: false, reason: "that link goes to a login, cart, checkout, or payment page" };
  }
  const t = page.target;
  if (t) {
    if (t.type?.toLowerCase() === "password") return { allowed: false, reason: "won't type into password fields" };
    if (t.autocomplete && BLOCKED_AUTOCOMPLETE.test(t.autocomplete)) {
      return { allowed: false, reason: "won't fill payment or credential fields" };
    }
    const label = [t.text, t.name].filter(Boolean).join(" ");
    if ((a.op === "click" || (a.op === "type" && a.submit)) && BLOCKED_TARGET_TEXT.test(label)) {
      return { allowed: false, reason: `"${(t.text ?? t.name ?? "").trim().slice(0, 60)}" is a purchase, booking, or sign-in step` };
    }
  }
  return { allowed: true };
}

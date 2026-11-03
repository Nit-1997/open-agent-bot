import type { AuthOutcome } from "./types.ts";

const HEX64 = /^[0-9a-f]{64}$/;
const SAME_SITE_OK = new Set(["same-origin", "none"]);
const LAUNCH_COOKIE = "oa_launch";

function hex64(name: string, value: string): string {
  if (!HEX64.test(value)) throw new Error(`localAuth: ${name} must be 64 lowercase hex characters`);
  return value;
}

function sameText(given: string, expected: string): boolean {
  let diff = given.length ^ expected.length;
  for (let i = 0; i < expected.length; i += 1) diff |= (given.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  return diff === 0;
}

function cookieValues(header: string | null, name: string): string[] {
  if (!header) return [];
  const values: string[] = [];
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) values.push(part.slice(at + 1).trim());
  }
  return values;
}

const badOrigin: AuthOutcome = { ok: false, status: 403, error: "bad_origin", message: "Requests from other sites aren't allowed." };
const launchRequired: AuthOutcome = {
  ok: false,
  status: 401,
  error: "launch_required",
  message: "Open Agent must be opened from the Open Agent app.",
};

export function localAuth(opts: { secret: string; launchToken?: string }): (req: Request) => Promise<AuthOutcome> {
  const headers = Object.freeze({ "x-agent-secret": hex64("secret", opts.secret) });
  const launchToken = opts.launchToken === undefined ? undefined : hex64("launchToken", opts.launchToken);
  return async (req) => {
    const site = req.headers.get("sec-fetch-site");
    if (site !== null && !SAME_SITE_OK.has(site)) return badOrigin;
    if (launchToken && !cookieValues(req.headers.get("cookie"), LAUNCH_COOKIE).some((v) => sameText(v, launchToken))) return launchRequired;
    return { ok: true, headers };
  };
}

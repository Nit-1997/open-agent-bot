import { isIP } from "node:net";

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export function isInternalHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  const v = isIP(h);
  if (v === 4) return isPrivateIPv4(h);
  if (v === 6) return h === "::1" || h === "::" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h.startsWith("::ffff:");
  return !h.includes(".");
}

export function publicHttpUrlError(raw: string, opts: { allowPrivateHosts?: boolean } = {}): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return `invalid url: ${raw}`;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return `unsupported url scheme ${u.protocol}`;
  if (!opts.allowPrivateHosts && isInternalHost(u.hostname)) return `refusing internal or private address ${u.hostname}`;
  return null;
}

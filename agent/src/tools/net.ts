import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const BLOCKING_STATUSES = new Set([401, 403, 429, 503]);

const MAX_REDIRECTS = 5;

function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
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

export type Lookup = (hostname: string) => Promise<string[]>;

export const dnsLookup: Lookup = async (hostname) => (await lookup(hostname, { all: true })).map((a) => a.address);

export async function resolvesInternal(hostname: string, resolve: Lookup = dnsLookup): Promise<boolean> {
  const h = hostname.replace(/^\[|\]$/g, "");
  if (isIP(h)) return isInternalHost(h);
  const addresses = await resolve(h).catch(() => []);
  return addresses.some(isInternalHost);
}

export function timeoutSignal(ms: number, signal?: AbortSignal): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
}

export async function fetchPublic(
  f: typeof fetch,
  url: string,
  init: RequestInit = {},
  opts: { allowPrivateHosts?: boolean; lookup?: Lookup } = {},
): Promise<{ res: Response; url: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const err = publicHttpUrlError(current, opts);
    if (err) throw new Error(err);
    const host = new URL(current).hostname;
    if (!opts.allowPrivateHosts && (await resolvesInternal(host, opts.lookup))) throw new Error(`refusing ${host}: it resolves to a private address`);
    const res = await f(current, { ...init, redirect: "manual" });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return { res, url: current };
    await res.body?.cancel().catch(() => {});
    current = new URL(location, current).href;
  }
  throw new Error(`too many redirects from ${new URL(url).host}`);
}

export async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, maxBytes));
}

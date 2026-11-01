import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export const BLOCKING_STATUSES = new Set([401, 403, 429, 503]);

const MAX_REDIRECTS = 5;

const BLOCKED_V4 = new BlockList();
const BLOCKED_V6 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  BLOCKED_V4.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 96],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const)
  BLOCKED_V6.addSubnet(net, prefix, "ipv6");

export function isBlockedAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return BLOCKED_V4.check(ip, "ipv4");
  if (v === 6) return BLOCKED_V6.check(new URL(`http://[${ip}]/`).hostname.slice(1, -1), "ipv6");
  return true;
}

function isInternalHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (isIP(h)) return isBlockedAddress(h);
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

export class BlockedAddressError extends Error {
  override name = "BlockedAddressError";
}

export function isBlockedError(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++)
    if (e instanceof BlockedAddressError) return true;
  return false;
}

function redirected(init: RequestInit, status: number, crossOrigin: boolean): RequestInit {
  const headers = new Headers(init.headers);
  if (crossOrigin) for (const name of ["authorization", "cookie", "proxy-authorization"]) headers.delete(name);
  const method = (init.method ?? "GET").toUpperCase();
  if (status === 303 ? method !== "HEAD" : (status === 301 || status === 302) && method === "POST") {
    headers.delete("content-type");
    headers.delete("content-length");
    return { ...init, method: status === 303 && method === "HEAD" ? "HEAD" : "GET", body: undefined, headers };
  }
  return { ...init, headers };
}

export async function fetchPublic(
  f: typeof fetch,
  url: string,
  init: RequestInit = {},
  opts: { allowPrivateHosts?: boolean; lookup?: Lookup } = {},
): Promise<{ res: Response; url: string }> {
  let current = url;
  let request: RequestInit = { ...init, headers: new Headers(init.headers) };
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const err = publicHttpUrlError(current, opts);
    if (err) throw new BlockedAddressError(err);
    const host = new URL(current).hostname;
    if (!opts.allowPrivateHosts && (await resolvesInternal(host, opts.lookup)))
      throw new BlockedAddressError(`refusing ${host}: it resolves to a private address`);
    const res = await f(current, { ...request, redirect: "manual" });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return { res, url: current };
    await res.body?.cancel().catch(() => {});
    const next = new URL(location, current);
    request = redirected(request, res.status, new URL(current).origin !== next.origin);
    current = next.href;
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

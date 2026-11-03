import type { Session } from "electron";
import type { Log } from "./logger.ts";

const GUARDED = new Set(["http:", "https:", "ws:", "wss:"]);
const DEFAULT_PORT: Readonly<Record<string, number>> = { "http:": 80, "ws:": 80, "https:": 443, "wss:": 443 };

const ipv4Loopback = (host: string) => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return m !== null && (m[1] === "127" || m[1] === "0");
};

function ipv6Loopback(inner: string): boolean {
  if (inner === "::1" || inner === "::") return true;
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(inner);
  if (mapped) {
    const hi = Number.parseInt(mapped[1] ?? "", 16);
    return hi >> 8 === 127 || hi >> 8 === 0;
  }
  return /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.test(inner) && ipv4Loopback(inner.slice(7));
}

export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (h.startsWith("[") && h.endsWith("]")) return ipv6Loopback(h.slice(1, -1));
  return h === "localhost" || h.endsWith(".localhost") || ipv4Loopback(h);
}

export function loopbackFirewall(url: string, appPort: number | undefined): "allow" | "cancel" {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "cancel";
  }
  if (!GUARDED.has(u.protocol) || !isLoopbackHost(u.hostname)) return "allow";
  const port = u.port === "" ? DEFAULT_PORT[u.protocol] : Number(u.port);
  return appPort !== undefined && u.hostname === "127.0.0.1" && port === appPort ? "allow" : "cancel";
}

export const describeUrl = (url: string) => {
  try {
    const u = new URL(url);
    return u.host ? `${u.protocol}//${u.host}${u.pathname}` : `${u.protocol}`;
  } catch {
    return "(invalid url)";
  }
};

export function installFirewall(ses: Session, appPort: () => number | undefined, log: Log): void {
  ses.webRequest.onBeforeRequest((details, callback) => {
    const decision = loopbackFirewall(details.url, appPort());
    if (decision === "cancel") log.warn(`[firewall] cancel ${details.resourceType} ${describeUrl(details.url)}`);
    callback({ cancel: decision === "cancel" });
  });
}

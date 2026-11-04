import type { LinkId } from "../shared/actions.ts";
import { isLoopbackHost } from "./firewall.ts";
import type { Log } from "./logger.ts";

export const LINKS: Readonly<Record<LinkId, string>> = {
  "get-docker-desktop": "https://www.docker.com/products/docker-desktop/",
  "get-orbstack": "https://orbstack.dev/",
  "get-colima": "https://github.com/abiosoft/colima",
  "install-guide": "https://github.com/Nit-1997/open-agent-bot/blob/main/docs/INSTALL.md",
  github: "https://github.com/Nit-1997/open-agent-bot",
  "release-page": "https://github.com/Nit-1997/open-agent-bot/releases/",
  "startup-errors": "https://github.com/Nit-1997/open-agent-bot#startup-errors",
};

export type UrlCheck =
  | { ok: true; url: string }
  | { ok: false; reason: "invalid" | "too_long" | "control_or_space" | "scheme" | "userinfo" | "not_canonical" | "loopback" };

const MAX_LENGTH = 2048;
const controlOrSpace = (s: string) => [...s].some((c) => (c.codePointAt(0) ?? 0) <= 0x1f || c === "\u007f" || /\s/.test(c));

export function validateExternalUrl(raw: string): UrlCheck {
  if (typeof raw !== "string") return { ok: false, reason: "invalid" };
  if (raw.length > MAX_LENGTH) return { ok: false, reason: "too_long" };
  if (controlOrSpace(raw)) return { ok: false, reason: "control_or_space" };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "scheme" };
  if (u.username || u.password) return { ok: false, reason: "userinfo" };
  if (u.href !== raw) return { ok: false, reason: "not_canonical" };
  if (isLoopbackHost(u.hostname)) return { ok: false, reason: "loopback" };
  return { ok: true, url: u.href };
}

export type OpenResult = "opened" | "dropped_rate" | "dropped_duplicate" | "refused";
export type ExternalOpener = (raw: string) => OpenResult;

export function createExternalOpener(deps: {
  now: () => number;
  open: (url: string) => void | Promise<void>;
  log: Log;
  minIntervalMs?: number;
  dedupeMs?: number;
}): ExternalOpener {
  const minInterval = deps.minIntervalMs ?? 1000;
  const dedupe = deps.dedupeMs ?? 10_000;
  let lastOpen = Number.NEGATIVE_INFINITY;
  const recent = new Map<string, number>();

  return (raw) => {
    const check = validateExternalUrl(raw);
    if (!check.ok) {
      deps.log.warn(`[external] refused ${check.reason}`);
      return "refused";
    }
    const t = deps.now();
    for (const [url, at] of recent) if (t - at >= dedupe) recent.delete(url);
    const origin = new URL(check.url).origin;
    if (recent.has(check.url)) {
      deps.log.warn(`[external] dropped duplicate ${origin}`);
      return "dropped_duplicate";
    }
    if (t - lastOpen < minInterval) {
      deps.log.warn(`[external] dropped rate ${origin}`);
      return "dropped_rate";
    }
    lastOpen = t;
    recent.set(check.url, t);
    deps.log.info(`[external] open ${origin}`);
    void Promise.resolve(deps.open(check.url)).catch((e: unknown) => deps.log.error(`[external] open failed ${String(e)}`));
    return "opened";
  };
}

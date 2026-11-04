import { isLoopbackHost } from "./firewall.ts";

export const SHELL_URL = "oa-shell://screens/index.html";
export const REPORT_PATH = /^\/api\/artifacts\/[A-Za-z0-9_-]{12}$/;

export type NavContext = Readonly<{
  view: "app" | "report" | "shell";
  appOrigin?: string;
  mainFrame: boolean;
  kind: "navigate" | "redirect" | "open";
}>;
export type NavDecision =
  | { action: "allow" }
  | { action: "deny" }
  | { action: "external"; url: string }
  | { action: "report"; url: string };

const DENY: NavDecision = { action: "deny" };
const ALLOW: NavDecision = { action: "allow" };

const parse = (url: string) => {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
};

export function navigationDecision(url: string, ctx: NavContext): NavDecision {
  const u = parse(url);
  if (!u) return DENY;
  if (ctx.view === "shell") return ctx.kind === "navigate" && u.href === SHELL_URL ? ALLOW : DENY;
  if (!ctx.appOrigin) return DENY;
  if (u.protocol !== "http:" && u.protocol !== "https:") return DENY;
  if (u.username || u.password) return DENY;
  if (u.origin === ctx.appOrigin) {
    if (ctx.kind !== "open") return ALLOW;
    return ctx.view === "app" && REPORT_PATH.test(u.pathname) && u.search === "" && u.hash === ""
      ? { action: "report", url: u.href }
      : DENY;
  }
  if (isLoopbackHost(u.hostname)) return DENY;
  if (ctx.kind === "open" || (ctx.view === "app" && ctx.kind === "navigate" && ctx.mainFrame)) return { action: "external", url: u.href };
  return DENY;
}

export const REPORT_OPEN_BUDGET = 3;

export function createOpenBudget(limit = REPORT_OPEN_BUDGET): Readonly<{ take(): boolean; spent(): boolean }> {
  let used = 0;
  return {
    take: () => {
      if (used >= limit) return false;
      used += 1;
      return true;
    },
    spent: () => used >= limit,
  };
}

export function subframeDecision(url: string, parentOrigin: string | undefined): "allow" | "cancel" {
  if (url === "about:blank" || url === "about:srcdoc") return "allow";
  if (!parentOrigin || parentOrigin === "null") return "cancel";
  const u = parse(url);
  return u && u.origin !== "null" && u.origin === parentOrigin ? "allow" : "cancel";
}

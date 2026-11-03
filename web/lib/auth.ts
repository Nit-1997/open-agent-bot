import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { hrefFor, parseRoute } from "@oab/shared/routes";
import { notFound, redirect } from "next/navigation";
import { appOrigin } from "@/lib/env";
import { type SessionUser, sessionUserFromClaims } from "@/lib/sessionUser";
import { createClient } from "@/lib/supabase/server";

export type AgentAuth = { userId: string; accessToken: string };

export class SignedOut extends Error {
  override name = "SignedOut";
}

export class AuthUnavailable extends Error {
  override name = "AuthUnavailable";
}

const MAX_NEXT_LENGTH = 512;

const hasControlChar = (s: string) => [...s].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

export function safeNext(raw: unknown, origin: string = appOrigin()): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_NEXT_LENGTH) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (/%2f|%5c/i.test(raw.split("?")[0])) return "/";
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return "/";
  }
  if (hasControlChar(decoded) || decoded.includes("\\") || decoded.startsWith("//")) return "/";
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return "/";
  }
  if (url.origin !== origin) return "/";
  const route = parseRoute(url.pathname, url.searchParams);
  return route ? hrefFor(route) : "/";
}

export async function getClaimsOrNull(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return sessionUserFromClaims(data?.claims);
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getClaimsOrNull();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isAdmin) notFound();
  return user;
}

export async function getAgentAuth(): Promise<AgentAuth> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (!data && isAuthRetryableFetchError(error)) throw new AuthUnavailable("auth_unavailable");
  const user = sessionUserFromClaims(data?.claims);
  if (!user) throw new SignedOut("signed_out");
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new SignedOut("signed_out");
  return { userId: user.id, accessToken };
}

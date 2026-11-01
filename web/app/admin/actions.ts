"use server";

import { type ActionResult, failure } from "@/lib/actionResult";
import { callAgent, jsonBody, withAgentAuth } from "@/lib/agentCall";
import type { AgentRequest } from "@/lib/agentServer";
import { type AccessRequestView, type AdminUser, isRequestFilter, type RequestAction, SEARCH_MAX, type UserAction } from "@/lib/admin";
import { getClaimsOrNull } from "@/lib/auth";
import { isUuid } from "@/lib/ids";
import { type Page, parsePage } from "@/lib/pagination";

const REQUEST_ACTIONS: readonly RequestAction[] = ["approve", "reject", "resend"];
const USER_ACTIONS: readonly UserAction[] = ["deactivate", "reactivate"];

const invalid = (message: string) => failure(400, "invalid", message);

async function adminCall<T>(path: string, init?: AgentRequest): Promise<ActionResult<T>> {
  const user = await getClaimsOrNull();
  if (!user?.isAdmin) return failure(404, "not_found", "Not found.");
  return withAgentAuth((auth) => callAgent<T>(path, auth, init));
}

export async function listRequests(filter: unknown, page: unknown): Promise<ActionResult<Page<AccessRequestView>>> {
  const n = parsePage(page);
  if (!isRequestFilter(filter) || n === null) return invalid("That filter isn't valid.");
  return adminCall(`/admin/access-requests?status=${filter}&page=${n}`);
}

export async function decideRequest(id: unknown, action: unknown): Promise<ActionResult<{ request: AccessRequestView }>> {
  if (!isUuid(id) || !REQUEST_ACTIONS.includes(action as RequestAction)) return invalid("That request isn't valid.");
  return adminCall(`/admin/access-requests/${id}/${action}`, { method: "POST" });
}

export async function listUsers(page: unknown, query: unknown): Promise<ActionResult<Page<AdminUser>>> {
  const n = parsePage(page);
  const q = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (n === null || q.length > SEARCH_MAX) return invalid("That search isn't valid.");
  const params = new URLSearchParams({ page: String(n) });
  if (q) params.set("q", q);
  return adminCall(`/admin/users?${params}`);
}

export async function setUserStatus(id: unknown, action: unknown): Promise<ActionResult<{ user: AdminUser }>> {
  if (!isUuid(id) || !USER_ACTIONS.includes(action as UserAction)) return invalid("That user isn't valid.");
  return adminCall(`/admin/users/${id}/${action}`, { method: "POST" });
}

export async function deleteUser(id: unknown, confirmEmail: unknown): Promise<ActionResult<{ ok: true }>> {
  if (!isUuid(id) || typeof confirmEmail !== "string" || confirmEmail.length > SEARCH_MAX)
    return invalid("Type the user's email to confirm.");
  return adminCall(`/admin/users/${id}`, { method: "DELETE", ...jsonBody({ confirmEmail: confirmEmail.trim() }) });
}

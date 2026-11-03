import type { AccessRequestView, RequestFilter } from "@oab/shared/admin";

export type RequestAction = "approve" | "reject" | "resend";
export type UserAction = "deactivate" | "reactivate";

export const FILTER_LABELS: Record<RequestFilter, string> = { pending: "Pending", approved: "Approved", rejected: "Rejected", all: "All" };

export const EMPTY_REQUESTS: Record<RequestFilter, string> = {
  pending: "No pending requests.",
  approved: "No approved requests.",
  rejected: "No rejected requests.",
  all: "No requests yet.",
};

export const SEARCH_MAX = 254;

export function requestNotice(action: RequestAction, request: AccessRequestView): string {
  if (action === "reject") return `Rejected ${request.email}.`;
  if (action === "resend") return `Invite sent again to ${request.email}.`;
  if (request.inviteStatus === null) return `Approved ${request.email}. They already have an account, so no invite was sent.`;
  return request.inviteStatus === "sent" ? `Approved ${request.email}. Invite sent.` : `Approved ${request.email}.`;
}

export function userNotice(action: UserAction | "delete", email: string): string {
  if (action === "delete") return `Deleted ${email}.`;
  return action === "deactivate" ? `Turned off access for ${email}.` : `Turned access back on for ${email}.`;
}

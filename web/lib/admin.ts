export const REQUEST_FILTERS = ["pending", "approved", "rejected", "all"] as const;
export type RequestFilter = (typeof REQUEST_FILTERS)[number];
export type RequestStatus = Exclude<RequestFilter, "all">;
export type RequestAction = "approve" | "reject" | "resend";
export type UserAction = "deactivate" | "reactivate";

export type AccessRequestView = {
  id: string;
  name: string;
  email: string;
  note: string;
  status: RequestStatus;
  inviteStatus: "sent" | "failed" | null;
  inviteError: string | null;
  ipHashPrefix: string;
  createdAt: string;
  decidedAt: string | null;
};

export type AdminUser = {
  id: string;
  email: string;
  status: "active" | "deactivated";
  createdAt: string;
  lastSignInAt: string | null;
  providers: string[];
  isAdmin: boolean;
};

export const FILTER_LABELS: Record<RequestFilter, string> = { pending: "Pending", approved: "Approved", rejected: "Rejected", all: "All" };

export const EMPTY_REQUESTS: Record<RequestFilter, string> = {
  pending: "No pending requests.",
  approved: "No approved requests.",
  rejected: "No rejected requests.",
  all: "No requests yet.",
};

export const isRequestFilter = (v: unknown): v is RequestFilter =>
  typeof v === "string" && (REQUEST_FILTERS as readonly string[]).includes(v);

export const SEARCH_MAX = 254;

export function requestNotice(action: RequestAction, request: AccessRequestView): string {
  if (action === "reject") return `Rejected ${request.email}.`;
  if (action === "resend") return `Invite sent again to ${request.email}.`;
  return request.inviteStatus === "sent" ? `Approved ${request.email}. Invite sent.` : `Approved ${request.email}.`;
}

export function userNotice(action: UserAction | "delete", email: string): string {
  if (action === "delete") return `Deleted ${email}.`;
  return action === "deactivate" ? `Turned off access for ${email}.` : `Turned access back on for ${email}.`;
}

export const REQUEST_FILTERS = ["pending", "approved", "rejected", "all"] as const;
export type RequestFilter = (typeof REQUEST_FILTERS)[number];
export type RequestStatus = Exclude<RequestFilter, "all">;
export type InviteStatus = "sent" | "failed";
export type UserStatus = "active" | "deactivated";

export const isRequestFilter = (v: unknown): v is RequestFilter =>
  typeof v === "string" && (REQUEST_FILTERS as readonly string[]).includes(v);

export type AccessRequestView = {
  id: string;
  name: string;
  email: string;
  note: string;
  status: RequestStatus;
  inviteStatus: InviteStatus | null;
  inviteError: string | null;
  ipHashPrefix: string;
  createdAt: string;
  decidedAt: string | null;
};

export type ProfileView = { id: string; email: string; status: UserStatus; createdAt: string };

export type AdminUser = ProfileView & { lastSignInAt: string | null; providers: string[]; isAdmin: boolean };

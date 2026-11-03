import { UserError } from "@oab/core/lib/errors.js";
import type { AccessRequestView, InviteStatus, ProfileView, RequestFilter, RequestStatus, UserStatus } from "@oab/shared/admin";
import { isUuid } from "@oab/shared/ids";
import { PAGE_SIZE, type Page } from "@oab/shared/pages";
import { fromBytea, toBytea } from "./bytea.js";
import type { Db } from "./client.js";
import type { Tables } from "./database.types.js";
import { must, read } from "./errors.js";
import { ARTIFACTS_BUCKET } from "./paths.js";
import { likePrefix, oneOf, pageOffset } from "./rows.js";

export type SubmitOutcome = "inserted" | "duplicate" | "already_member" | "rate_limited_ip" | "rate_limited_global";

const SUBMIT_OUTCOMES: readonly SubmitOutcome[] = ["inserted", "duplicate", "already_member", "rate_limited_ip", "rate_limited_global"];
const REQUEST_STATUSES: readonly RequestStatus[] = ["pending", "approved", "rejected"];
const INVITE_STATUSES: readonly InviteStatus[] = ["sent", "failed"];
const USER_STATUSES: readonly UserStatus[] = ["active", "deactivated"];

const STORAGE_PAGE = 100;

const REQUEST_COLUMNS = "id, name, email, note, status, invite_status, invite_error, ip_hash, created_at, decided_at";
const PROFILE_COLUMNS = "user_id, email, status, created_at";

type RequestRow = Pick<
  Tables<"access_requests">,
  "id" | "name" | "email" | "note" | "status" | "invite_status" | "invite_error" | "ip_hash" | "created_at" | "decided_at"
>;
type ProfileRow = Pick<Tables<"profiles">, "user_id" | "email" | "status" | "created_at">;

const toRequest = (r: RequestRow): AccessRequestView => ({
  id: r.id,
  name: r.name,
  email: r.email,
  note: r.note,
  status: oneOf(REQUEST_STATUSES, r.status, "access_requests.status"),
  inviteStatus: r.invite_status === null ? null : oneOf(INVITE_STATUSES, r.invite_status, "access_requests.invite_status"),
  inviteError: r.invite_error,
  ipHashPrefix: fromBytea(r.ip_hash).toString("hex").slice(0, 8),
  createdAt: r.created_at,
  decidedAt: r.decided_at,
});

const toProfile = (r: ProfileRow): ProfileView => ({
  id: r.user_id,
  email: r.email,
  status: oneOf(USER_STATUSES, r.status, "profiles.status"),
  createdAt: r.created_at,
});

export type InviteOutcome = { inviteStatus: InviteStatus; inviteError: string | null };
export type Decision =
  | { status: "approved"; decidedBy: string; userId: string | null; invite: InviteOutcome | null }
  | { status: "rejected"; decidedBy: string };

const missingRequest = () => new UserError("That request doesn't exist.", "not_found");

export function createAdminRepo(db: Db) {
  const requestById = async (id: string) => {
    if (!isUuid(id)) return undefined;
    const { data } = await read("accessRequests.get", () => db.from("access_requests").select(REQUEST_COLUMNS).eq("id", id).maybeSingle());
    return data ? toRequest(data) : undefined;
  };

  const updateRequest = async (where: string, id: string, patch: Partial<Tables<"access_requests">>, onlyPending: boolean) => {
    if (!isUuid(id)) throw missingRequest();
    let q = db.from("access_requests").update(patch).eq("id", id);
    if (onlyPending) q = q.eq("status", "pending");
    const { data } = await must(where, q.select(REQUEST_COLUMNS));
    const row = data?.[0];
    if (row) return toRequest(row);
    if (!onlyPending || !(await requestById(id))) throw missingRequest();
    throw new UserError("This request was already decided.", "conflict", { code: "already_decided" });
  };

  const inviteColumns = (o: InviteOutcome | null) => ({
    invite_status: o?.inviteStatus ?? null,
    invite_error: o?.inviteError?.slice(0, 500) ?? null,
  });

  return {
    accessRequests: {
      async submit(input: { name: string; email: string; note: string; ipHash: Buffer }): Promise<SubmitOutcome> {
        const { data } = await must(
          "accessRequests.submit",
          db.rpc("access_request_submit", {
            p_name: input.name,
            p_email: input.email,
            p_note: input.note,
            p_ip_hash: toBytea(input.ipHash),
          }),
        );
        return oneOf(SUBMIT_OUTCOMES, data ?? "", "access_request_submit result");
      },
      async page(filter: RequestFilter, page: number): Promise<Page<AccessRequestView>> {
        const from = pageOffset(page);
        const { data, count } = await read("accessRequests.page", () => {
          let q = db.from("access_requests").select(REQUEST_COLUMNS, { count: "exact" });
          if (filter !== "all") q = q.eq("status", filter);
          return q
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, from + PAGE_SIZE - 1);
        });
        return { items: (data ?? []).map(toRequest), total: count ?? 0 };
      },
      get: requestById,
      decide(id: string, d: Decision): Promise<AccessRequestView> {
        const decided = { status: d.status, decided_by: d.decidedBy, decided_at: new Date().toISOString() };
        const patch = d.status === "approved" ? { ...decided, user_id: d.userId, ...inviteColumns(d.invite) } : decided;
        return updateRequest("accessRequests.decide", id, patch, true);
      },
      setInvite(id: string, invite: InviteOutcome, userId: string | null): Promise<AccessRequestView> {
        return updateRequest("accessRequests.setInvite", id, { ...inviteColumns(invite), ...(userId && { user_id: userId }) }, false);
      },
      async deleteByEmail(email: string): Promise<void> {
        await must("accessRequests.deleteByEmail", db.from("access_requests").delete().eq("email", email));
      },
    },
    invited: {
      async add(email: string, requestId: string | null, invitedBy: string | null): Promise<void> {
        await must(
          "invited.add",
          db
            .from("invited_emails")
            .upsert({ email, request_id: requestId, invited_by: invitedBy }, { onConflict: "email", ignoreDuplicates: true }),
        );
      },
      async remove(email: string): Promise<void> {
        await must("invited.remove", db.from("invited_emails").delete().eq("email", email));
      },
    },
    users: {
      async page(page: number, q?: string): Promise<Page<ProfileView>> {
        const from = pageOffset(page);
        const { data, count } = await read("users.page", () => {
          let query = db.from("profiles").select(PROFILE_COLUMNS, { count: "exact" });
          if (q) query = query.like("email", likePrefix(q.toLowerCase()));
          return query
            .order("created_at", { ascending: false })
            .order("user_id", { ascending: false })
            .range(from, from + PAGE_SIZE - 1);
        });
        return { items: (data ?? []).map(toProfile), total: count ?? 0 };
      },
      async get(id: string): Promise<ProfileView | undefined> {
        if (!isUuid(id)) return undefined;
        const { data } = await read("users.get", () => db.from("profiles").select(PROFILE_COLUMNS).eq("user_id", id).maybeSingle());
        return data ? toProfile(data) : undefined;
      },
      async findByEmail(email: string): Promise<ProfileView | undefined> {
        const { data } = await read("users.findByEmail", () =>
          db.from("profiles").select(PROFILE_COLUMNS).eq("email", email).maybeSingle(),
        );
        return data ? toProfile(data) : undefined;
      },
      async status(id: string): Promise<UserStatus | undefined> {
        const { data } = await read("users.status", () => db.from("profiles").select("status").eq("user_id", id).maybeSingle());
        return data ? oneOf(USER_STATUSES, data.status, "profiles.status") : undefined;
      },
      async setStatus(id: string, status: UserStatus): Promise<void> {
        await must("users.setStatus", db.from("profiles").update({ status }).eq("user_id", id));
      },
    },
    storage: {
      async removeUserFiles(userId: string): Promise<void> {
        if (!isUuid(userId)) throw new Error("removeUserFiles needs a user id");
        const bucket = db.storage.from(ARTIFACTS_BUCKET);
        for (;;) {
          const { data, error } = await bucket.list(userId, { limit: STORAGE_PAGE, offset: 0 });
          if (error) throw new UserError("Couldn't list the user's files.", "upstream");
          if (!data.length) return;
          const { error: removeError } = await bucket.remove(data.map((o) => `${userId}/${o.name}`));
          if (removeError) throw new UserError("Couldn't remove the user's files.", "upstream");
        }
      },
    },
  };
}

export type AdminRepo = ReturnType<typeof createAdminRepo>;

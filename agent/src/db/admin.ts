import { UserError } from "../lib/errors.js";
import type { Db } from "./client.js";
import { fromBytea, toBytea } from "./bytea.js";
import { must, read, timeout } from "./errors.js";
import { PAGE_SIZE, type Page } from "./types.js";

export type RequestStatus = "pending" | "approved" | "rejected";
export type RequestFilter = RequestStatus | "all";
export type SubmitOutcome = "inserted" | "duplicate" | "already_member" | "rate_limited_ip" | "rate_limited_global";

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

export type UserStatus = "active" | "deactivated";
export type ProfileView = { id: string; email: string; status: UserStatus; createdAt: string };

type RequestRowDb = {
  id: string;
  name: string;
  email: string;
  note: string;
  status: RequestStatus;
  invite_status: "sent" | "failed" | null;
  invite_error: string | null;
  ip_hash: string;
  created_at: string;
  decided_at: string | null;
};

const REQUEST_COLUMNS = "id, name, email, note, status, invite_status, invite_error, ip_hash, created_at, decided_at";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toRequest = (r: RequestRowDb): AccessRequestView => ({
  id: r.id,
  name: r.name,
  email: r.email,
  note: r.note,
  status: r.status,
  inviteStatus: r.invite_status,
  inviteError: r.invite_error,
  ipHashPrefix: fromBytea(r.ip_hash).toString("hex").slice(0, 8),
  createdAt: r.created_at,
  decidedAt: r.decided_at,
});

type ProfileRowDb = { user_id: string; email: string; status: UserStatus; created_at: string };
const toProfile = (r: ProfileRowDb): ProfileView => ({ id: r.user_id, email: r.email, status: r.status, createdAt: r.created_at });

const offset = (page: number) => (Math.max(1, Math.floor(page)) - 1) * PAGE_SIZE;
const likePrefix = (q: string) => `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export type InviteOutcome = { inviteStatus: "sent" | "failed"; inviteError: string | null };
export type Decision =
  | { status: "approved"; decidedBy: string; userId: string | null; invite: InviteOutcome | null }
  | { status: "rejected"; decidedBy: string };

export function createAdminRepo(db: Db) {
  const requestById = async (id: string) => {
    if (!UUID_RE.test(id)) return undefined;
    const { data } = await read("accessRequests.get", () =>
      db.from("access_requests").select(REQUEST_COLUMNS).eq("id", id).abortSignal(timeout()).maybeSingle<RequestRowDb>(),
    );
    return data ? toRequest(data) : undefined;
  };

  const updateRequest = async (where: string, id: string, patch: Record<string, unknown>, onlyPending: boolean) => {
    let q = db.from("access_requests").update(patch).eq("id", id);
    if (onlyPending) q = q.eq("status", "pending");
    const { data } = await must(where, q.select(REQUEST_COLUMNS).abortSignal(timeout()));
    const row = (data as RequestRowDb[] | null)?.[0];
    if (!row) throw new UserError("This request was already decided.", "conflict", { code: "already_decided" });
    return toRequest(row);
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
          db
            .rpc("access_request_submit", {
              p_name: input.name,
              p_email: input.email,
              p_note: input.note,
              p_ip_hash: toBytea(input.ipHash),
            })
            .abortSignal(timeout()),
        );
        return data as SubmitOutcome;
      },
      async page(filter: RequestFilter, page: number): Promise<Page<AccessRequestView>> {
        const from = offset(page);
        const { data, count } = await read("accessRequests.page", () => {
          let q = db.from("access_requests").select(REQUEST_COLUMNS, { count: "exact" });
          if (filter !== "all") q = q.eq("status", filter);
          return q
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(from, from + PAGE_SIZE - 1)
            .abortSignal(timeout());
        });
        return { items: ((data ?? []) as RequestRowDb[]).map(toRequest), total: count ?? 0 };
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
        await must("accessRequests.deleteByEmail", db.from("access_requests").delete().eq("email", email).abortSignal(timeout()));
      },
    },
    invited: {
      async add(email: string, requestId: string | null, invitedBy: string | null): Promise<void> {
        await must(
          "invited.add",
          db
            .from("invited_emails")
            .upsert({ email, request_id: requestId, invited_by: invitedBy }, { onConflict: "email", ignoreDuplicates: true })
            .abortSignal(timeout()),
        );
      },
      async remove(email: string): Promise<void> {
        await must("invited.remove", db.from("invited_emails").delete().eq("email", email).abortSignal(timeout()));
      },
    },
    users: {
      async page(page: number, q?: string): Promise<Page<ProfileView>> {
        const from = offset(page);
        const { data, count } = await read("users.page", () => {
          let query = db.from("profiles").select("user_id, email, status, created_at", { count: "exact" });
          if (q) query = query.like("email", likePrefix(q.toLowerCase()));
          return query
            .order("created_at", { ascending: false })
            .order("user_id", { ascending: false })
            .range(from, from + PAGE_SIZE - 1)
            .abortSignal(timeout());
        });
        return { items: ((data ?? []) as ProfileRowDb[]).map(toProfile), total: count ?? 0 };
      },
      async get(id: string): Promise<ProfileView | undefined> {
        if (!UUID_RE.test(id)) return undefined;
        const { data } = await read("users.get", () =>
          db
            .from("profiles")
            .select("user_id, email, status, created_at")
            .eq("user_id", id)
            .abortSignal(timeout())
            .maybeSingle<ProfileRowDb>(),
        );
        return data ? toProfile(data) : undefined;
      },
      async findByEmail(email: string): Promise<ProfileView | undefined> {
        const { data } = await read("users.findByEmail", () =>
          db
            .from("profiles")
            .select("user_id, email, status, created_at")
            .eq("email", email)
            .abortSignal(timeout())
            .maybeSingle<ProfileRowDb>(),
        );
        return data ? toProfile(data) : undefined;
      },
      async status(id: string): Promise<UserStatus | undefined> {
        const { data } = await read("users.status", () =>
          db.from("profiles").select("status").eq("user_id", id).abortSignal(timeout()).maybeSingle<{ status: UserStatus }>(),
        );
        return data?.status;
      },
      async setStatus(id: string, status: UserStatus): Promise<void> {
        await must("users.setStatus", db.from("profiles").update({ status }).eq("user_id", id).abortSignal(timeout()));
      },
    },
  };
}

export type AdminRepo = ReturnType<typeof createAdminRepo>;

"use client";

import type { AdminUser } from "@oab/shared/admin";
import type { PageResponse } from "@oab/shared/pages";
import { useState } from "react";
import { deleteUser, listUsers, setUserStatus } from "@/app/admin/actions";
import { ghost, input } from "@oab/ui/components/profile/models/styles.ts";
import { DetailList } from "@oab/ui/components/ui/DetailList.tsx";
import { Pager } from "@oab/ui/components/ui/Pager.tsx";
import type { ActionResult } from "@/lib/actionResult";
import { SEARCH_MAX, type UserAction, userNotice } from "@/lib/admin";
import { formatWhen } from "@oab/ui/lib/chats.ts";
import { ConfirmDialog } from "./ConfirmDialog";
import { usePagedAdminList } from "./usePagedAdminList";

type Pending = { user: AdminUser; kind: "deactivate" | "delete" };

const ID = "admin-users";

export function UsersList({
  initial,
  initialQuery = "",
  selfId,
}: {
  initial: ActionResult<PageResponse<AdminUser>>;
  initialQuery?: string;
  selfId: string;
}) {
  const list = usePagedAdminList<AdminUser, string>({ initial, initialQuery, fetchPage: (q, page) => listUsers(page, q) });
  const { query, page, result, loading, busyRow, rowErrors, hiddenErrors, notice, load } = list;
  const [draft, setDraft] = useState(initialQuery);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const act = async (user: AdminUser, action: UserAction | "delete", confirmEmail = "") => {
    await list.act<unknown>(
      user,
      () => (action === "delete" ? deleteUser(user.id, confirmEmail) : setUserStatus(user.id, action)),
      () => userNotice(action, user.email),
    );
    setPending(null);
  };

  return (
    <section id={ID} aria-label="Users" className="space-y-3">
      <form
        id={`${ID}-search`}
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void load(draft.trim(), 1);
        }}
        className="flex gap-2"
      >
        <label id={`${ID}-search-label`} htmlFor={`${ID}-search-input`} className="sr-only">
          Search users by email
        </label>
        <input
          id={`${ID}-search-input`}
          type="search"
          maxLength={SEARCH_MAX}
          autoComplete="off"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Email starts with…"
          className={input}
        />
        <button id={`${ID}-search-submit`} type="submit" disabled={loading} className={ghost}>
          Search
        </button>
        {query && (
          <button
            id={`${ID}-search-clear`}
            type="button"
            disabled={loading}
            onClick={() => {
              setDraft("");
              void load("", 1);
            }}
            className={ghost}
          >
            Clear
          </button>
        )}
      </form>

      {notice && (
        <p id={`${ID}-notice`} role="status" className="rounded-xl bg-surface px-3 py-2 text-xs text-success-fg">
          {notice}
        </p>
      )}
      {hiddenErrors.length > 0 && (
        <div id={`${ID}-action-errors`} role="alert" className="space-y-1 rounded-xl bg-danger-bg px-3 py-2 text-xs text-danger-fg">
          {hiddenErrors.map(([uid, e]) => (
            <p id={`${ID}-action-error-${uid}`} key={uid}>{`${e.email}: ${e.message}`}</p>
          ))}
        </div>
      )}

      {!result.ok && (
        <div
          id={`${ID}-load-error`}
          role="alert"
          className="flex items-center justify-between gap-2 rounded-xl bg-danger-bg px-3 py-2 text-xs text-danger-fg"
        >
          <span id={`${ID}-load-error-text`}>{`Couldn't load users: ${result.message}`}</span>
          <button id={`${ID}-retry`} type="button" disabled={loading} onClick={() => void load(query, page)} className={ghost}>
            Retry
          </button>
        </div>
      )}

      {result.ok && result.data.total === 0 && (
        <p id={`${ID}-empty`} className="text-sm text-text-muted">
          {query ? `No users with an email starting "${query}".` : "No users yet."}
        </p>
      )}

      {result.ok && result.data.total > 0 && (
        <>
          <ul id={`${ID}-list`} aria-busy={loading} className="space-y-2">
            {result.data.items.map((u) => {
              const rowId = `${ID}-row-${u.id}`;
              const open = expanded === u.id;
              const self = u.id === selfId;
              const busy = busyRow !== null;
              return (
                <li id={rowId} key={u.id} className="rounded-2xl border border-border bg-paper p-3">
                  <div id={`${rowId}-head`} className="flex flex-wrap items-center gap-2">
                    <div id={`${rowId}-who`} className="min-w-0 flex-1">
                      <p id={`${rowId}-email`} className="truncate text-sm font-medium text-text-primary">
                        {u.email}
                      </p>
                      <p id={`${rowId}-meta`} className="truncate text-[12px] text-text-muted">
                        {`Joined ${formatWhen(u.createdAt)}${u.isAdmin ? " · admin" : ""}${self ? " · you" : ""}`}
                      </p>
                    </div>
                    <span
                      id={`${ID}-status-${u.id}`}
                      className={`rounded-full px-2 py-0.5 text-[11px] ${u.status === "active" ? "bg-surface text-success-fg" : "bg-danger-bg text-danger-fg"}`}
                    >
                      {u.status === "active" ? "active" : "turned off"}
                    </span>
                    <div id={`${rowId}-actions`} className="flex flex-wrap gap-1.5">
                      <button
                        id={`${ID}-view-${u.id}`}
                        type="button"
                        aria-expanded={open}
                        onClick={() => setExpanded(open ? null : u.id)}
                        className={ghost}
                      >
                        View
                      </button>
                      {!self && u.status === "active" && (
                        <button
                          id={`${ID}-deactivate-${u.id}`}
                          type="button"
                          disabled={busy}
                          onClick={() => setPending({ user: u, kind: "deactivate" })}
                          className={ghost}
                        >
                          Deactivate
                        </button>
                      )}
                      {!self && u.status === "deactivated" && (
                        <button
                          id={`${ID}-reactivate-${u.id}`}
                          type="button"
                          disabled={busy}
                          onClick={() => void act(u, "reactivate")}
                          className={ghost}
                        >
                          {busyRow === u.id ? "Working…" : "Reactivate"}
                        </button>
                      )}
                      {!self && (
                        <button
                          id={`${ID}-delete-${u.id}`}
                          type="button"
                          disabled={busy}
                          onClick={() => setPending({ user: u, kind: "delete" })}
                          className={`${ghost} text-danger-fg`}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                  {open && (
                    <DetailList
                      id={`${ID}-details-${u.id}`}
                      items={[
                        ["id", "User id", u.id],
                        ["email", "Email", u.email],
                        ["status", "Status", u.status],
                        ["role", "Role", u.isAdmin ? "admin" : "user"],
                        ["created", "Joined", formatWhen(u.createdAt)],
                        ["last-sign-in", "Last sign-in", formatWhen(u.lastSignInAt)],
                        ["providers", "Sign-in methods", u.providers.length ? u.providers.join(", ") : "—"],
                      ]}
                    />
                  )}
                  {rowErrors[u.id] && (
                    <p id={`${ID}-row-error-${u.id}`} role="alert" className="mt-2 text-xs text-danger-fg">
                      {rowErrors[u.id].message}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <Pager
            id={`${ID}-pager`}
            page={result.data.page}
            pageSize={result.data.pageSize}
            total={result.data.total}
            busy={loading}
            onPage={(p) => void load(query, p)}
          />
        </>
      )}

      {pending?.kind === "deactivate" && (
        <ConfirmDialog
          id={`${ID}-confirm`}
          title="Turn off this account?"
          body={`${pending.user.email} is signed out within 30 seconds and can't sign in again until you reactivate them.`}
          confirmLabel="Deactivate"
          busy={busyRow === pending.user.id}
          onConfirm={() => void act(pending.user, "deactivate")}
          onCancel={() => setPending(null)}
        />
      )}
      {pending?.kind === "delete" && (
        <ConfirmDialog
          id={`${ID}-confirm`}
          title="Delete this account?"
          body={`This deletes ${pending.user.email} with their chats, keys, artifacts and requests. It can't be undone.`}
          confirmLabel="Delete account"
          requireText={pending.user.email}
          busy={busyRow === pending.user.id}
          onConfirm={(typed) => void act(pending.user, "delete", typed)}
          onCancel={() => setPending(null)}
        />
      )}
    </section>
  );
}

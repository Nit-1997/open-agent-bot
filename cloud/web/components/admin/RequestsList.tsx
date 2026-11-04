"use client";

import { type AccessRequestView, REQUEST_FILTERS, type RequestFilter } from "@oab/shared/admin";
import type { PageResponse } from "@oab/shared/pages";
import { useState } from "react";
import { decideRequest, listRequests } from "@/app/admin/actions";
import { ghost, solid } from "@oab/ui/components/profile/models/styles.ts";
import { DetailList } from "@oab/ui/components/ui/DetailList.tsx";
import { Pager } from "@oab/ui/components/ui/Pager.tsx";
import type { ActionResult } from "@/lib/actionResult";
import { EMPTY_REQUESTS, FILTER_LABELS, type RequestAction, requestNotice } from "@/lib/admin";
import { formatWhen } from "@oab/ui/lib/chats.ts";
import { ConfirmDialog } from "./ConfirmDialog";
import { usePagedAdminList } from "./usePagedAdminList";

const ID = "admin-requests";

function statusText(r: AccessRequestView): string {
  if (r.status !== "approved" || !r.inviteStatus) return r.status;
  return r.inviteStatus === "sent" ? "approved · invite sent" : "approved · invite failed";
}

export function RequestsList({ initial }: { initial: ActionResult<PageResponse<AccessRequestView>> }) {
  const list = usePagedAdminList<AccessRequestView, RequestFilter>({
    initial,
    initialQuery: "pending",
    fetchPage: (filter, page) => listRequests(filter, page),
  });
  const { query: filter, page, result, loading, busyRow, rowErrors, hiddenErrors, notice, load } = list;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<AccessRequestView | null>(null);

  const act = async (request: AccessRequestView, action: RequestAction) => {
    await list.act(
      request,
      () => decideRequest(request.id, action),
      (data) => requestNotice(action, data.request),
    );
    setRejecting(null);
  };

  return (
    <section id={ID} aria-label="Access requests" className="space-y-3">
      <div id={`${ID}-filters`} role="group" aria-label="Filter requests" className="flex flex-wrap gap-1.5">
        {REQUEST_FILTERS.map((f) => (
          <button
            id={`${ID}-filter-${f}`}
            key={f}
            type="button"
            aria-pressed={filter === f}
            disabled={loading}
            onClick={() => void load(f, 1)}
            className={filter === f ? solid : ghost}
          >
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      {notice && (
        <p id={`${ID}-notice`} role="status" className="rounded-xl bg-surface px-3 py-2 text-xs text-success-fg">
          {notice}
        </p>
      )}
      {hiddenErrors.length > 0 && (
        <div id={`${ID}-action-errors`} role="alert" className="space-y-1 rounded-xl bg-danger-bg px-3 py-2 text-xs text-danger-fg">
          {hiddenErrors.map(([rid, e]) => (
            <p id={`${ID}-action-error-${rid}`} key={rid}>{`${e.email}: ${e.message}`}</p>
          ))}
        </div>
      )}

      {!result.ok && (
        <div
          id={`${ID}-load-error`}
          role="alert"
          className="flex items-center justify-between gap-2 rounded-xl bg-danger-bg px-3 py-2 text-xs text-danger-fg"
        >
          <span id={`${ID}-load-error-text`}>{`Couldn't load requests: ${result.message}`}</span>
          <button id={`${ID}-retry`} type="button" disabled={loading} onClick={() => void load(filter, page)} className={ghost}>
            Retry
          </button>
        </div>
      )}

      {result.ok && result.data.total === 0 && (
        <p id={`${ID}-empty`} className="text-sm text-text-muted">
          {EMPTY_REQUESTS[filter]}
        </p>
      )}

      {result.ok && result.data.total > 0 && (
        <>
          <ul id={`${ID}-list`} aria-busy={loading} className="space-y-2">
            {result.data.items.map((r) => {
              const rowId = `${ID}-row-${r.id}`;
              const open = expanded === r.id;
              const busy = busyRow !== null;
              return (
                <li id={rowId} key={r.id} className="rounded-2xl border border-border bg-paper p-3">
                  <div id={`${rowId}-head`} className="flex flex-wrap items-center gap-2">
                    <div id={`${rowId}-who`} className="min-w-0 flex-1">
                      <p id={`${rowId}-name`} className="truncate text-sm font-medium text-text-primary">
                        {r.name}
                      </p>
                      <p id={`${rowId}-email`} className="truncate text-[12px] text-text-muted">
                        {`${r.email} · ${formatWhen(r.createdAt)}`}
                      </p>
                    </div>
                    <span id={`${ID}-status-${r.id}`} className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-text-secondary">
                      {statusText(r)}
                    </span>
                    <div id={`${rowId}-actions`} className="flex flex-wrap gap-1.5">
                      <button
                        id={`${ID}-view-${r.id}`}
                        type="button"
                        aria-expanded={open}
                        onClick={() => setExpanded(open ? null : r.id)}
                        className={ghost}
                      >
                        View
                      </button>
                      {r.status === "pending" && (
                        <>
                          <button
                            id={`${ID}-approve-${r.id}`}
                            type="button"
                            disabled={busy}
                            onClick={() => void act(r, "approve")}
                            className={solid}
                          >
                            {busyRow === r.id ? "Approving…" : "Approve"}
                          </button>
                          <button
                            id={`${ID}-reject-${r.id}`}
                            type="button"
                            disabled={busy}
                            onClick={() => setRejecting(r)}
                            className={ghost}
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {r.status === "approved" && (
                        <button
                          id={`${ID}-resend-${r.id}`}
                          type="button"
                          disabled={busy}
                          onClick={() => void act(r, "resend")}
                          className={ghost}
                        >
                          {busyRow === r.id ? "Sending…" : "Resend invite"}
                        </button>
                      )}
                    </div>
                  </div>
                  {open && (
                    <DetailList
                      id={`${ID}-details-${r.id}`}
                      items={[
                        ["name", "Name", r.name],
                        ["email", "Email", r.email],
                        ["note", "Note", r.note || "—"],
                        ["ip", "IP hash", r.ipHashPrefix],
                        ["created", "Asked", formatWhen(r.createdAt)],
                        ["decided", "Decided", r.decidedAt ? formatWhen(r.decidedAt) : "—"],
                        ["invite", "Invite", r.inviteStatus ?? "—"],
                        ["invite-error", "Invite error", r.inviteError ?? "—"],
                      ]}
                    />
                  )}
                  {rowErrors[r.id] && (
                    <p id={`${ID}-row-error-${r.id}`} role="alert" className="mt-2 text-xs text-danger-fg">
                      {rowErrors[r.id].message}
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
            onPage={(p) => void load(filter, p)}
          />
        </>
      )}

      {rejecting && (
        <ConfirmDialog
          id={`${ID}-confirm`}
          title="Reject this request?"
          body={`${rejecting.name} (${rejecting.email}) won't get an email. They can ask again later.`}
          confirmLabel="Reject"
          busy={busyRow === rejecting.id}
          onConfirm={() => void act(rejecting, "reject")}
          onCancel={() => setRejecting(null)}
        />
      )}
    </section>
  );
}

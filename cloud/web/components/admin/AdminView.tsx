"use client";

import Link from "next/link";
import { useState } from "react";
import type { AccessRequestView, AdminUser } from "@oab/shared/admin";
import type { PageResponse } from "@oab/shared/pages";
import type { AdminUsageRow, AdminUsageSummary } from "@oab/shared/usage";
import { listUsers } from "@/app/admin/actions";
import { type ActionResult, runAction } from "@/lib/actionResult";
import { RequestsList } from "./RequestsList";
import { UsageTab } from "./UsageTab";
import { UsersList } from "./UsersList";

type Tab = "requests" | "users" | "usage";
const TABS: Array<[Tab, string]> = [
  ["requests", "Requests"],
  ["users", "Users"],
  ["usage", "Usage"],
];

type UsersView = { seq: number; query: string; initial: ActionResult<PageResponse<AdminUser>> };

export function AdminView(props: {
  email: string;
  selfId: string;
  requests: ActionResult<PageResponse<AccessRequestView>>;
  users: ActionResult<PageResponse<AdminUser>>;
  usageSummary: ActionResult<AdminUsageSummary>;
  usage: ActionResult<PageResponse<AdminUsageRow>>;
}) {
  const [tab, setTab] = useState<Tab>("requests");
  const [users, setUsers] = useState<UsersView>({ seq: 0, query: "", initial: props.users });

  const openUser = async (email: string) => {
    const query = email.trim().toLowerCase();
    const initial = await runAction(() => listUsers(1, query));
    setUsers((u) => ({ seq: u.seq + 1, query, initial }));
    setTab("users");
  };

  return (
    <main id="admin-page" className="flex min-h-dvh w-full justify-center p-2 sm:p-4">
      <div id="admin-frame" className="glass flex w-full max-w-[920px] flex-col gap-4 rounded-[28px] p-4 sm:p-6">
        <header id="admin-header" className="flex flex-wrap items-center justify-between gap-2">
          <div id="admin-heading">
            <h1 id="admin-title" className="font-display text-[28px] leading-none text-text-primary">
              Admin
            </h1>
            <p id="admin-email" className="mt-1 text-[12px] text-text-muted">
              {props.email}
            </p>
          </div>
          <Link
            id="admin-back"
            href="/"
            className="rounded-full border border-border px-3.5 py-1.5 text-[12px] font-medium text-text-secondary"
          >
            Back to chat
          </Link>
        </header>
        <div id="admin-tabs" role="tablist" aria-label="Admin sections" className="flex gap-1.5 border-b border-border pb-2">
          {TABS.map(([key, label]) => (
            <button
              id={`admin-tab-${key}`}
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              aria-controls={`admin-panel-${key}`}
              onClick={() => setTab(key)}
              className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition ${
                tab === key ? "bg-charcoal text-on-charcoal" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div id="admin-panel-requests" role="tabpanel" aria-labelledby="admin-tab-requests" hidden={tab !== "requests"}>
          <RequestsList initial={props.requests} />
        </div>
        <div id="admin-panel-users" role="tabpanel" aria-labelledby="admin-tab-users" hidden={tab !== "users"}>
          <UsersList key={users.seq} initial={users.initial} initialQuery={users.query} selfId={props.selfId} />
        </div>
        <div id="admin-panel-usage" role="tabpanel" aria-labelledby="admin-tab-usage" hidden={tab !== "usage"}>
          <UsageTab summary={props.usageSummary} users={props.usage} onOpenUser={(email) => void openUser(email)} />
        </div>
      </div>
    </main>
  );
}

import type { AdminUsageDetail, AdminUsageSummary, Limits, UsageFilter } from "@oab/shared/usage";
import { pageCount, rangeText } from "@oab/ui/lib/pagination.ts";
import { formatWhen } from "@oab/ui/lib/chats.ts";
import { relativeTime } from "@oab/ui/lib/dates.ts";
import { shortUtcDay } from "@/lib/usageCopy";

export const USAGE_SEARCH_DEBOUNCE_MS = 300;

export const USAGE_FILTER_LABELS: Record<UsageFilter, string> = { all: "All users", at_limit: "At the monthly limit" };

export const SIGNUP_MODE_NOTE = "Changed by the owner with configure-auth";

const count = (n: number) => n.toLocaleString("en-US");

export const limitsText = (l: Limits) =>
  `${count(l.runningPerUser)} running per user · ${count(l.perHour)} per hour · ${count(l.perMonth)} per month · ${count(l.runningServer)} running on the server`;

export const signupsText = (s: NonNullable<AdminUsageSummary["signups"]>) =>
  `New accounts: ${count(s.lastHour)} in the last hour (cap ${count(s.capHour)}) · ${count(s.lastDay)} today (cap ${count(s.capDay)})`;

export const totalsCopy = (s: AdminUsageSummary) => ({
  monthTotal: ["Requests this month", count(s.month.total)],
  activeUsers: ["Active users", count(s.month.activeUsers)],
  running: ["Running now", `${count(s.running.now)} / ${count(s.running.limit)}`],
});

export const countText = (page: number, pageSize: number, total: number) =>
  `${rangeText(page, pageSize, total)} · newest first · ${pageSize} per page`;

export const pageText = (page: number, pageSize: number, total: number) => `Page ${page} of ${pageCount(pageSize, total)}`;

export const usedText = (used: number, limit: number) => `${count(used)} / ${count(limit)}`;

export const lastText = (iso: string | null, now: Date = new Date()) => (iso ? relativeTime(iso, now) : "never");

export function minutesUntil(iso: string, now: number): number {
  return Math.max(1, Math.ceil((Date.parse(iso) - now) / 60_000));
}

export function detailItems(d: AdminUsageDetail, now: Date = new Date()): Array<[string, string, string]> {
  const hour = usedText(d.hour.used, d.hour.limit);
  return [
    ["status", "Status", d.status],
    ["month", "Month used", `${usedText(d.month.used, d.month.limit)} · resets ${shortUtcDay(d.month.resetsAt)}`],
    ["hour", "Hour used", d.hour.resetsAt ? `${hour} · resets in ${minutesUntil(d.hour.resetsAt, now.getTime())} min` : hour],
    ["running", "Running now", d.running.now > 0 ? `${d.running.now} of ${d.running.limit}` : "no"],
    ["last", "Last request", d.lastAt ? `${relativeTime(d.lastAt, now)} (${formatWhen(d.lastAt)})` : "never"],
  ];
}

export const emptyText = (filtered: boolean) => (filtered ? "No users match these filters." : "No requests this month yet.");

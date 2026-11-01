import type { PlanSummary } from "@shared/lists";
import type { EntityKind } from "@shared/workspace";
import { CalendarDays, ListChecks, type LucideIcon, Plane, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { relativeTime } from "@/lib/dates";

export const KIND_ICON: Record<EntityKind, LucideIcon> = { cart: ShoppingCart, trip: Plane, event: CalendarDays, shortlist: ListChecks };

const action =
  "inline-flex items-center rounded-full border border-border px-3 py-1.5 text-[12px] font-medium text-text-secondary transition hover:border-border-strong hover:text-text-primary";

export const planHref = (p: Pick<PlanSummary, "chatId" | "kind" | "key">) => `/plans/${p.chatId}/${p.kind}/${p.key}`;

export function PlanRow({ id, plan }: { id: string; plan: PlanSummary }) {
  const Icon = KIND_ICON[plan.kind];
  return (
    <li id={id} className="flex flex-col gap-3 rounded-2xl border border-surface-accent bg-surface p-4 sm:flex-row sm:items-center">
      <span
        id={`${id}-icon`}
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-paper text-text-secondary"
      >
        <Icon id={`${id}-icon-svg`} aria-hidden="true" size={17} />
      </span>
      <div id={`${id}-text`} className="min-w-0 flex-1">
        <h2 id={`${id}-title`} title={plan.title} className="truncate text-[15px] font-semibold text-text-primary">
          <bdi id={`${id}-title-bdi`}>{plan.title}</bdi>
        </h2>
        <p id={`${id}-line`} className="mt-0.5 break-words text-[13px] text-text-secondary">
          {`${plan.kind}: ${plan.line}`}
        </p>
        <p id={`${id}-meta`} className="mt-0.5 truncate text-[12px] text-text-muted">
          <bdi id={`${id}-chat`}>{plan.chatTitle}</bdi>
          {` · Updated ${relativeTime(plan.updatedAt)}`}
        </p>
      </div>
      <div id={`${id}-actions`} className="flex shrink-0 gap-2">
        <Link id={`${id}-view`} href={planHref(plan)} className={action}>
          View
        </Link>
        <Link id={`${id}-chat-link`} href={`/chats/${plan.chatId}`} className={action}>
          Open chat
        </Link>
      </div>
    </li>
  );
}

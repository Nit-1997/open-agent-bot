"use client";

import type { EntityKind } from "@shared/workspace";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BackLink } from "@/components/reports/ReportDetail";
import { ListState } from "@/components/ui/ListState";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { CartCard } from "@/components/widgets/CartCard";
import { PlanCard } from "@/components/widgets/PlanCard";
import { ApiError } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { type PlanDetailResponse, plansApi } from "@/lib/plans";

type State =
  | { status: "loading" }
  | { status: "ready"; data: PlanDetailResponse }
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "error"; error: string };

const action =
  "inline-flex items-center rounded-full border border-border px-3 py-1.5 text-[12px] font-medium text-text-secondary transition hover:border-border-strong hover:text-text-primary";

export function PlanDetail(props: { chatId: string; kind: EntityKind; planKey: string }) {
  const { chatId, kind, planKey } = props;
  const id = "plan-detail";
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; value: State } | null>(null);
  const key = `${chatId}/${kind}/${planKey}:${attempt}`;

  useEffect(() => {
    const ac = new AbortController();
    plansApi
      .get(chatId, kind, planKey, ac.signal)
      .then((data) => setState({ key, value: { status: "ready", data } }))
      .catch((e: unknown) => {
        if (ac.signal.aborted) return;
        const status = e instanceof ApiError ? e.status : 0;
        const value: State =
          status === 404 ? { status: "missing" } : status === 422 ? { status: "invalid" } : { status: "error", error: errorMessage(e) };
        setState({ key, value });
      });
    return () => ac.abort();
  }, [chatId, kind, planKey, key]);

  const current: State = state?.key === key ? state.value : { status: "loading" };
  const back = <BackLink id={`${id}-back`} href="/plans" label="All plans" />;
  const openChat = (
    <Link id={`${id}-open-chat`} href={`/chats/${chatId}`} className={action}>
      Open chat
    </Link>
  );
  const toolCallId = `detail-${kind}-${planKey}`;

  return (
    <div id={id} className="min-h-0 flex-1 overflow-y-auto">
      <div id={`${id}-inner`} className="mx-auto w-full max-w-[880px] px-4 pb-10 sm:px-7">
        {current.status === "loading" && (
          <div id={`${id}-loading`} aria-busy="true" className="flex flex-col gap-3 pt-6">
            {back}
            <div id={`${id}-loading-title`} className="h-9 w-2/3 animate-pulse rounded-xl bg-surface" />
            <div id={`${id}-loading-card`} className="h-64 animate-pulse rounded-2xl bg-surface" />
          </div>
        )}
        {current.status === "missing" && (
          <div id={`${id}-missing`} className="flex flex-col gap-3 py-10">
            {back}
            <h1 id={`${id}-missing-title`} className="font-display text-[28px] text-text-primary">
              This plan doesn&apos;t exist or isn&apos;t yours.
            </h1>
          </div>
        )}
        {current.status === "invalid" && (
          <div id={`${id}-invalid`} className="flex flex-col gap-3 py-10">
            {back}
            <h1 id={`${id}-invalid-title`} className="font-display text-[26px] text-text-primary">
              This plan was saved in an older shape and can&apos;t be shown here. Open its chat to see it.
            </h1>
            <div id={`${id}-invalid-actions`}>{openChat}</div>
          </div>
        )}
        {current.status === "error" && (
          <div id={`${id}-failed`} className="flex flex-col gap-3 py-6">
            {back}
            <ListState
              id={`${id}-error`}
              state={{ kind: "error", message: `Couldn't load this plan: ${current.error}`, onRetry: () => setAttempt((a) => a + 1) }}
            />
          </div>
        )}
        {current.status === "ready" && (
          <>
            <SectionHeader
              id={`${id}-header`}
              title={current.data.plan.title}
              back={back}
              actions={
                <>
                  <span id={`${id}-from`} className="max-w-[260px] truncate text-[13px] text-text-muted">
                    {"From: "}
                    <bdi id={`${id}-from-bdi`}>{current.data.plan.chatTitle}</bdi>
                  </span>
                  {openChat}
                </>
              }
            />
            {current.data.widget.kind === "cart" ? (
              <CartCard toolCallId={toolCallId} widget={current.data.widget} />
            ) : (
              <PlanCard toolCallId={toolCallId} widget={current.data.widget} />
            )}
            <p id={`${id}-note`} className="mt-3 text-[13px] text-text-muted">
              To change this plan, open its chat.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

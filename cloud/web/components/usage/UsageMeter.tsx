"use client";

import type { UsageView } from "@oab/shared/usage";
import { DESKTOP_URL, METER_COPY, meterLevel } from "@/lib/usageCopy";
import { useUsage } from "./useUsage";

type Variant = "sidebar" | "sheet";

const FRAME: Record<Variant, string> = {
  sidebar: "rounded-2xl border border-surface-accent bg-surface p-3",
  sheet: "mx-2 mb-2 rounded-2xl border border-surface-accent bg-surface p-3",
};

function MacLine({ id }: { id: string }) {
  return (
    <p id={`${id}-mac`}>
      {METER_COPY.macLead}
      <a
        id={`${id}-mac-link`}
        href={DESKTOP_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium underline underline-offset-2"
      >
        {METER_COPY.macLink}
      </a>
      {METER_COPY.macTail}
    </p>
  );
}

function Counts({ id, view }: { id: string; view: UsageView }) {
  const { used, limit, resetsAt } = view.month;
  const level = meterLevel(used, limit);
  const shown = Math.min(used, limit);
  const left = limit - used;
  const warn = level !== "normal";
  return (
    <>
      <div id={`${id}-head`} className="flex items-baseline justify-between gap-2 text-[13px]">
        <span id={`${id}-label`} className="font-semibold text-text-primary">
          {METER_COPY.label}
        </span>
        <span id={`${id}-reset`} title={METER_COPY.resetHint} className="text-text-muted">
          {METER_COPY.reset(resetsAt)}
        </span>
      </div>
      <div
        id={`${id}-bar`}
        role="progressbar"
        aria-label={METER_COPY.barLabel}
        aria-valuenow={shown}
        aria-valuemin={0}
        aria-valuemax={limit}
        className="my-1.5 h-2 overflow-hidden rounded-full bg-surface-accent"
      >
        <span
          id={`${id}-bar-fill`}
          className={`block h-full rounded-full ${warn ? "bg-warn-fg" : "bg-mist-500"}`}
          style={{ width: `${Math.round((shown / limit) * 100)}%` }}
        />
      </div>
      <p id={`${id}-count`} className="text-[13px] text-text-secondary">
        {METER_COPY.count(used, limit)}
      </p>
      {warn && (
        <div id={`${id}-note`} className="mt-2.5 space-y-1 rounded-lg bg-warn-bg px-2.5 py-2 text-[12.5px] text-warn-fg">
          {level === "low" ? (
            <p id={`${id}-low`}>{METER_COPY.low(left)}</p>
          ) : (
            <p id={`${id}-exhausted`}>{METER_COPY.exhausted(resetsAt)}</p>
          )}
          <MacLine id={id} />
        </div>
      )}
      {view.humanCheck === "required" && (
        <p id={`${id}-check`} className="mt-2 text-[12.5px] text-text-secondary">
          {METER_COPY.check}
        </p>
      )}
    </>
  );
}

export function UsageMeter({ id, variant }: { id: string; variant: Variant }) {
  const { state, retry } = useUsage();
  if (state.kind === "loading")
    return (
      <div id={id} aria-busy="true" className={FRAME[variant]}>
        <div id={`${id}-skeleton`} className="space-y-2">
          <span id={`${id}-skeleton-line-1`} className="block h-3 w-2/3 rounded-full bg-surface-accent" />
          <span id={`${id}-skeleton-line-2`} className="block h-2 w-full rounded-full bg-surface-accent" />
        </div>
      </div>
    );
  if (state.kind === "unavailable")
    return (
      <div id={id} className={`${FRAME[variant]} flex items-center justify-between gap-2`}>
        <p id={`${id}-unavailable`} className="text-[13px] text-text-secondary">
          {METER_COPY.unavailable}
        </p>
        <button
          id={`${id}-retry`}
          type="button"
          onClick={retry}
          className="rounded-full border border-border px-3 py-1 text-[12px] font-medium text-text-primary hover:border-border-strong focus-visible:outline-2 focus-visible:outline-mist-500"
        >
          {METER_COPY.retry}
        </button>
      </div>
    );
  return (
    <div id={id} data-level={meterLevel(state.view.month.used, state.view.month.limit)} className={FRAME[variant]}>
      <Counts id={id} view={state.view} />
    </div>
  );
}

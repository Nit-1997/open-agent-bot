import type { ReactNode } from "react";

export type ListStatus =
  | { kind: "loading"; rows?: number; shape?: "row" | "card" }
  | { kind: "empty"; children: ReactNode }
  | { kind: "error"; message: string; onRetry: () => void };

const ghost =
  "rounded-full border border-border px-3 py-1 text-[12px] font-medium text-text-secondary transition hover:border-border-strong hover:text-text-primary";

export function ListState(props: { id: string; state: ListStatus }) {
  const { id, state } = props;
  if (state.kind === "loading") {
    const rows = state.rows ?? 3;
    const card = state.shape === "card";
    return (
      <div id={id} aria-busy="true" aria-label="Loading" className={card ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3" : "space-y-1.5"}>
        {Array.from({ length: rows }, (_, i) => (
          <div id={`${id}-skeleton-${i}`} key={i} className={`animate-pulse rounded-xl bg-surface ${card ? "h-36 rounded-2xl" : "h-10"}`} />
        ))}
      </div>
    );
  }
  if (state.kind === "empty")
    return (
      <div id={id} className="px-2.5 py-3 text-[13px] leading-relaxed text-text-muted">
        {state.children}
      </div>
    );
  return (
    <div
      id={id}
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-danger-bg px-3 py-2 text-[13px] text-danger-fg"
    >
      <span id={`${id}-text`} className="min-w-0 flex-1">
        {state.message}
      </span>
      <button id={`${id}-retry`} type="button" onClick={state.onRetry} className={ghost}>
        Retry
      </button>
    </div>
  );
}

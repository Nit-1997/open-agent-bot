import { SEARCH_SCOPES, type SearchScope } from "@shared/lists";
import type { KeyboardEvent } from "react";

const LABEL: Record<SearchScope, string> = { all: "All", chats: "Chats", reports: "Reports" };

export function SearchScopeTabs(props: {
  id: string;
  value: SearchScope;
  counts?: { chats: number; reports: number };
  onChange: (scope: SearchScope) => void;
}) {
  const { id, counts } = props;
  const n: Record<SearchScope, number | undefined> = counts
    ? { all: counts.chats + counts.reports, chats: counts.chats, reports: counts.reports }
    : { all: undefined, chats: undefined, reports: undefined };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const focused = SEARCH_SCOPES.findIndex((scope) => e.target === document.getElementById(`${id}-${scope}`));
    const at = focused < 0 ? SEARCH_SCOPES.indexOf(props.value) : focused;
    const last = SEARCH_SCOPES.length - 1;
    const to = { ArrowRight: at === last ? 0 : at + 1, ArrowLeft: at === 0 ? last : at - 1, Home: 0, End: last }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const scope = SEARCH_SCOPES[to];
    document.getElementById(`${id}-${scope}`)?.focus();
    props.onChange(scope);
  };
  return (
    <div id={id} role="tablist" aria-label="Search in" onKeyDown={onKeyDown} className="flex gap-1.5 border-b border-surface-accent">
      {SEARCH_SCOPES.map((scope) => {
        const on = props.value === scope;
        return (
          <button
            id={`${id}-${scope}`}
            key={scope}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            aria-controls={`${id}-panel`}
            onClick={() => props.onChange(scope)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] transition ${on ? "border-text-primary font-medium text-text-primary" : "border-transparent text-text-muted hover:text-text-primary"}`}
          >
            {n[scope] === undefined ? LABEL[scope] : `${LABEL[scope]} · ${n[scope]}`}
          </button>
        );
      })}
    </div>
  );
}

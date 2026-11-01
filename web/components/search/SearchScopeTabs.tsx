import type { SearchScope } from "@shared/lists";

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
  return (
    <div id={id} role="tablist" aria-label="Search in" className="flex gap-1.5 border-b border-surface-accent">
      {(["all", "chats", "reports"] as const).map((scope) => {
        const on = props.value === scope;
        return (
          <button
            id={`${id}-${scope}`}
            key={scope}
            type="button"
            role="tab"
            aria-selected={on}
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

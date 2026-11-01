import type { PlanCounts } from "@shared/lists";
import type { EntityKind } from "@shared/workspace";

export const KIND_LABEL: Record<EntityKind, { one: string; many: string }> = {
  cart: { one: "cart", many: "Carts" },
  trip: { one: "trip", many: "Trips" },
  event: { one: "event", many: "Events" },
  shortlist: { one: "shortlist", many: "Shortlists" },
};

const ORDER: Array<EntityKind | null> = [null, "cart", "trip", "event", "shortlist"];

export function PlanKindFilter(props: {
  id: string;
  value: EntityKind | null;
  counts?: PlanCounts;
  onChange: (kind: EntityKind | null) => void;
}) {
  const { id, counts } = props;
  return (
    <div id={id} role="radiogroup" aria-label="Show plans" className="flex flex-wrap gap-2 pb-4">
      {ORDER.map((kind) => {
        const on = props.value === kind;
        const label = kind ? KIND_LABEL[kind].many : "All";
        const n = counts ? (kind ? counts[kind] : counts.all) : undefined;
        return (
          <button
            id={`${id}-${kind ?? "all"}`}
            key={kind ?? "all"}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => props.onChange(kind)}
            className={`rounded-full border px-3 py-1.5 text-[13px] transition ${on ? "border-charcoal bg-charcoal font-medium text-on-charcoal" : "border-border bg-surface text-text-secondary hover:border-border-strong"}`}
          >
            {n === undefined ? label : `${label} · ${n}`}
          </button>
        );
      })}
    </div>
  );
}

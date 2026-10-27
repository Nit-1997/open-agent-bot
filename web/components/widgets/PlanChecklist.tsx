import type { PlanChecklist as PlanChecklistData } from "@shared/widgets";
import { Card, ExternalLink } from "./Card";

export function PlanChecklist({ toolCallId, widget }: { toolCallId: string; widget: PlanChecklistData }) {
  const id = `plan-checklist-${toolCallId}`;
  return (
    <Card id={id} title={widget.title}>
      {widget.sections.map((s, si) => (
        <div id={`${id}-section-${si}`} key={si} className="mt-3">
          <h4 id={`${id}-section-${si}-name`} className="text-sm font-semibold">
            {s.name}
          </h4>
          <ul id={`${id}-section-${si}-items`} className="mt-1 space-y-1">
            {s.items.map((it, ii) => {
              const iid = `${id}-section-${si}-item-${ii}`;
              return (
                <li id={iid} key={ii} className="flex items-start gap-2 text-sm">
                  <input id={`${iid}-check`} type="checkbox" aria-label={it.label} className="mt-1" />
                  <span id={`${iid}-body`} className="flex flex-1 flex-wrap gap-x-2">
                    {it.url ? (
                      <ExternalLink id={`${iid}-label`} href={it.url}>
                        {it.label}
                      </ExternalLink>
                    ) : (
                      <span id={`${iid}-label`}>{it.label}</span>
                    )}
                    {it.quantity && (
                      <span id={`${iid}-quantity`} className="text-neutral-500">
                        {it.quantity}
                      </span>
                    )}
                    {it.note && (
                      <span id={`${iid}-note`} className="w-full text-xs text-neutral-500">
                        {it.note}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </Card>
  );
}

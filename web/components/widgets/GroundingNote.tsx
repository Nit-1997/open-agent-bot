import type { GroundingNote as GroundingNoteData } from "@shared/widgets";
import { widgetId } from "./widgetId";

export function GroundingNote({ toolCallId, idPrefix, widget }: { toolCallId: string; idPrefix?: string; widget: GroundingNoteData }) {
  const id = widgetId("grounding-note", toolCallId, idPrefix);
  return (
    <p id={id} role="note" className="flex items-start gap-2 rounded-xl bg-warn-bg px-3 py-2 text-xs leading-relaxed text-warn-fg">
      {`Not found in the sources I read: ${widget.claims.join(", ")}. Treat these as unverified and check the link before relying on them.`}
    </p>
  );
}

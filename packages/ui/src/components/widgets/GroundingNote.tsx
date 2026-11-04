import type { GroundingNote as GroundingNoteData } from "@oab/shared/widgets";
import { widgetId } from "./widgetId";

export function GroundingNote({ toolCallId, idPrefix, widget }: { toolCallId: string; idPrefix?: string; widget: GroundingNoteData }) {
  const id = widgetId("grounding-note", toolCallId, idPrefix);
  return (
    <div id={id} role="note" className="flex flex-col gap-1 rounded-xl bg-warn-bg px-3 py-2 text-xs leading-relaxed text-warn-fg">
      {widget.claims.length > 0 && (
        <p id={`${id}-unsourced`}>
          {`Not found in the sources I read: ${widget.claims.join(", ")}. Treat these as unverified and check the link before relying on them.`}
        </p>
      )}
      {widget.fromReport?.length ? (
        <p
          id={`${id}-report`}
        >{`From your open report: ${widget.fromReport.join(", ")}. Not checked against new sources in this reply.`}</p>
      ) : null}
    </div>
  );
}

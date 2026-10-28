import type { GroundingNote as GroundingNoteData } from "@shared/widgets";

export function GroundingNote({ toolCallId, widget }: { toolCallId: string; widget: GroundingNoteData }) {
  const id = `grounding-note-${toolCallId}`;
  return (
    <p id={id} role="note" className="my-1 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
      {`Not found in the sources I read: ${widget.claims.join(", ")}. Treat these as unverified and check the link before relying on them.`}
    </p>
  );
}

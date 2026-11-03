"use client";

import { FileText } from "lucide-react";
import { widgetId } from "@/components/widgets/widgetId";
import { parseArtifactId } from "@/lib/reportRefs";
import { ReportThumb } from "./ReportThumb";

const HINT = { right: "Report · open on the right", tap: "Report · tap to read" } as const;

export function ReportCard(props: {
  idPrefix: string;
  toolCallId: string;
  title: string;
  result: string | undefined;
  current: boolean;
  hint: "right" | "tap";
  onOpen: (reportId: string, toolCallId: string) => void;
}) {
  const { title, result, current, hint } = props;
  const id = widgetId("artifact-card", props.toolCallId, props.idPrefix);
  const width = hint === "tap" ? "w-full sm:w-[320px]" : "w-[320px] max-w-full";
  const tall = hint === "tap";

  if (result === undefined) {
    return (
      <div
        id={`${id}-pending`}
        role="status"
        className={`my-2 overflow-hidden rounded-2xl border border-surface-accent bg-surface ${width}`}
      >
        <span id={`${id}-pending-thumb`} aria-hidden="true" className={`block animate-pulse bg-paper ${tall ? "h-[150px]" : "h-32"}`} />
        <span id={`${id}-pending-row`} className="flex items-center gap-2.5 px-3.5 py-3">
          <Tile id={`${id}-pending-icon`} />
          <span id={`${id}-pending-text`} className="flex min-w-0 flex-col gap-0.5">
            <span id={`${id}-pending-title`} className="truncate text-[14px] font-medium text-text-primary">
              <bdi id={`${id}-pending-title-bdi`}>{title || "Report"}</bdi>
            </span>
            <span id={`${id}-pending-hint`} className="text-[12px] text-text-faint">
              Writing the report…
            </span>
          </span>
        </span>
      </div>
    );
  }

  const reportId = parseArtifactId(result);
  if (!reportId) {
    return (
      <p id={`${id}-error`} className="my-2 text-sm text-danger-fg">
        Couldn&apos;t create the page{result ? `: ${result}` : "."}
      </p>
    );
  }

  return (
    <button
      id={id}
      type="button"
      aria-current={current ? "true" : undefined}
      aria-label={`Open report: ${title}`}
      onClick={() => props.onOpen(reportId, props.toolCallId)}
      className={`my-2 block overflow-hidden rounded-2xl border bg-surface p-0 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mist-500 ${width} ${
        current ? "report-card-current border-mist-500" : "border-surface-accent hover:border-border"
      }`}
    >
      <ReportThumb id={`${id}-thumb`} reportId={reportId} tall={tall} />
      <span id={`${id}-row`} className="flex min-h-11 items-center gap-2.5 px-3.5 py-3">
        <Tile id={`${id}-icon`} />
        <span id={`${id}-text`} className="flex min-w-0 flex-col gap-0.5">
          <span id={`${id}-title`} title={title} className="truncate text-[14px] font-medium text-text-primary">
            <bdi id={`${id}-title-bdi`}>{title}</bdi>
          </span>
          <span id={`${id}-hint`} className="text-[12px] text-text-faint">
            {HINT[hint]}
          </span>
        </span>
      </span>
    </button>
  );
}

function Tile({ id }: { id: string }) {
  return (
    <span
      id={id}
      aria-hidden="true"
      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-paper text-mist-500"
    >
      <FileText id={`${id}-glyph`} aria-hidden="true" size={15} />
    </span>
  );
}

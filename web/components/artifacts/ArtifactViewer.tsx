"use client";

import { ARTIFACT_SANDBOX } from "@shared/artifacts";
import { useEffect } from "react";

export function ArtifactViewer({ artifactId, title, onClose }: { artifactId: string; title: string; onClose: () => void }) {
  const id = `artifact-viewer-${artifactId}`;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div id={id} role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex flex-col bg-paper">
      <div id={`${id}-bar`} className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <span id={`${id}-title`} className="truncate text-sm font-medium">
          {title}
        </span>
        <div id={`${id}-actions`} className="flex gap-2">
          <a
            id={`${id}-pdf`}
            href={`/api/artifacts/${artifactId}?format=pdf`}
            className="rounded-full border border-border px-3.5 py-1.5 text-[13px] font-medium"
          >
            Download PDF
          </a>
          <button
            id={`${id}-close`}
            type="button"
            onClick={onClose}
            className="rounded-full bg-charcoal px-3.5 py-1.5 text-[13px] font-medium text-on-charcoal"
          >
            Close
          </button>
        </div>
      </div>
      <iframe
        id={`${id}-frame`}
        title={title}
        sandbox={ARTIFACT_SANDBOX}
        src={`/api/artifacts/${artifactId}`}
        className="min-h-0 w-full flex-1 bg-white"
      />
    </div>
  );
}

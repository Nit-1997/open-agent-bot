"use client";

import { useEffect } from "react";

export function ArtifactViewer({ artifactId, title, onClose }: { artifactId: string; title: string; onClose: () => void }) {
  const id = `artifact-viewer-${artifactId}`;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div id={id} role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-neutral-950">
      <div id={`${id}-bar`} className="flex items-center justify-between gap-2 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
        <span id={`${id}-title`} className="truncate text-sm font-medium">
          {title}
        </span>
        <div id={`${id}-actions`} className="flex gap-2">
          <a id={`${id}-pdf`} href={`/api/artifacts/${artifactId}?format=pdf`} className="rounded-md border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700">
            Download PDF
          </a>
          <button id={`${id}-close`} type="button" onClick={onClose} className="rounded-md bg-neutral-900 px-3 py-1 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900">
            Close
          </button>
        </div>
      </div>
      <iframe id={`${id}-frame`} title={title} sandbox="allow-scripts" src={`/api/artifacts/${artifactId}`} className="min-h-0 w-full flex-1 bg-white" />
    </div>
  );
}

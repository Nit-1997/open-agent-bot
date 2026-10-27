"use client";

import { useState } from "react";
import { ArtifactViewer } from "./ArtifactViewer";

export function parseArtifactId(result: string | undefined): string | null {
  const m = /artifact ([A-Za-z0-9_-]{12}) created/.exec(result ?? "");
  return m ? m[1] : null;
}

export function ArtifactCard({ toolCallId, title, result }: { toolCallId: string; title: string; result: string | undefined }) {
  const [open, setOpen] = useState(false);
  const artifactId = parseArtifactId(result);
  const id = `artifact-card-${toolCallId}`;
  if (!artifactId) {
    return (
      <p id={`${id}-error`} className="my-2 text-sm text-red-700 dark:text-red-400">
        Couldn&apos;t create the page{result ? `: ${result}` : "."}
      </p>
    );
  }
  return (
    <div id={id} className="my-2 flex items-center justify-between gap-3 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
      <div id={`${id}-text`} className="min-w-0">
        <p id={`${id}-title`} className="truncate text-sm font-semibold">
          {title}
        </p>
        <p id={`${id}-kind`} className="text-xs text-neutral-500">
          Page · open full screen or download as PDF
        </p>
      </div>
      <div id={`${id}-actions`} className="flex shrink-0 gap-2">
        <button id={`${id}-open`} type="button" onClick={() => setOpen(true)} className="rounded-md bg-neutral-900 px-3 py-1 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900">
          Open
        </button>
        <a id={`${id}-pdf`} href={`/api/artifacts/${artifactId}?format=pdf`} className="rounded-md border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700">
          Download PDF
        </a>
      </div>
      {open && <ArtifactViewer artifactId={artifactId} title={title} onClose={() => setOpen(false)} />}
    </div>
  );
}

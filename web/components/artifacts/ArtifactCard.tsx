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
      <p id={`${id}-error`} className="my-2 text-sm text-danger-fg">
        Couldn&apos;t create the page{result ? `: ${result}` : "."}
      </p>
    );
  }
  return (
    <div id={id} className="flex items-center gap-3 rounded-2xl border border-border bg-paper p-3 transition hover:border-border-strong">
      <span id={`${id}-thumb`} aria-hidden="true" style={{ background: "var(--accent-gradient)" }} className="flex h-12 w-10 shrink-0 items-center justify-center rounded-lg border border-border font-display text-lg italic text-cortex-600">
        Aa
      </span>
      <div id={`${id}-text`} className="min-w-0 flex-1">
        <p id={`${id}-title`} className="truncate text-[15px] font-medium text-text-primary">
          {title}
        </p>
        <p id={`${id}-kind`} className="eyebrow mt-1">
          Page · PDF ready
        </p>
      </div>
      <div id={`${id}-actions`} className="flex shrink-0 gap-1.5">
        <a id={`${id}-pdf`} aria-label="Download PDF" href={`/api/artifacts/${artifactId}?format=pdf`} className="rounded-full border border-border px-3.5 py-1.5 text-[13px] font-medium text-text-secondary transition hover:border-border-strong">
          PDF
        </a>
        <button id={`${id}-open`} type="button" onClick={() => setOpen(true)} className="rounded-full bg-charcoal px-3.5 py-1.5 text-[13px] font-medium text-on-charcoal transition hover:opacity-85">
          Open
        </button>
      </div>
      {open && <ArtifactViewer artifactId={artifactId} title={title} onClose={() => setOpen(false)} />}
    </div>
  );
}

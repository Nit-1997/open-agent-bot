"use client";

import { Download, ExternalLink, Maximize2 } from "lucide-react";
import { useState } from "react";
import { reportHtmlHref, reportPdfHref } from "@/lib/reports";
import { ArtifactFrame } from "./ArtifactFrame";
import { ArtifactViewer } from "./ArtifactViewer";

export function parseArtifactId(result: string | undefined): string | null {
  const m = /artifact ([A-Za-z0-9_-]{12}) created/.exec(result ?? "");
  return m ? m[1] : null;
}

const action =
  "flex h-8 w-8 items-center justify-center rounded-full text-text-secondary transition hover:bg-surface hover:text-text-primary";

export function ArtifactCard({ toolCallId, title, result }: { toolCallId: string; title: string; result: string | undefined }) {
  const [fullScreen, setFullScreen] = useState(false);
  const artifactId = parseArtifactId(result);
  const id = `artifact-card-${toolCallId}`;
  if (!artifactId) {
    return (
      <p id={`${id}-error`} className="my-2 text-sm text-danger-fg">
        Couldn&apos;t create the page{result ? `: ${result}` : "."}
      </p>
    );
  }
  const src = reportHtmlHref(artifactId);
  return (
    <section id={id} aria-label={title} className="my-2 overflow-hidden rounded-2xl border border-border bg-paper">
      <header id={`${id}-bar`} className="flex items-center gap-3 border-b border-border px-3 py-2">
        <span
          id={`${id}-thumb`}
          aria-hidden="true"
          style={{ background: "var(--accent-gradient)" }}
          className="flex h-9 w-8 shrink-0 items-center justify-center rounded-md border border-border font-display text-base italic text-mist-600"
        >
          Aa
        </span>
        <div id={`${id}-text`} className="min-w-0 flex-1">
          <p id={`${id}-title`} className="truncate text-[15px] font-medium text-text-primary">
            {title}
          </p>
          <p id={`${id}-kind`} className="eyebrow mt-0.5">
            Report · scroll to read
          </p>
        </div>
        <div id={`${id}-actions`} className="flex shrink-0 items-center gap-0.5">
          <button
            id={`${id}-fullscreen`}
            type="button"
            aria-label="Open full screen"
            title="Full screen"
            onClick={() => setFullScreen(true)}
            className={action}
          >
            <Maximize2 id={`${id}-fullscreen-icon`} aria-hidden="true" size={15} />
          </button>
          <a
            id={`${id}-new-tab`}
            aria-label="Open in new tab"
            title="Open in new tab"
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className={action}
          >
            <ExternalLink id={`${id}-new-tab-icon`} aria-hidden="true" size={15} />
          </a>
          <a id={`${id}-pdf`} aria-label="Download PDF" title="Download PDF" href={reportPdfHref(artifactId)} className={action}>
            <Download id={`${id}-pdf-icon`} aria-hidden="true" size={15} />
          </a>
        </div>
      </header>
      <ArtifactFrame
        id={`${id}-frame`}
        artifactId={artifactId}
        title={title}
        lazy
        className="block h-[min(58vh,520px)] min-h-[280px] sm:h-[min(70vh,640px)] sm:min-h-[360px] w-full bg-white"
      />
      {fullScreen && <ArtifactViewer artifactId={artifactId} title={title} onClose={() => setFullScreen(false)} />}
    </section>
  );
}

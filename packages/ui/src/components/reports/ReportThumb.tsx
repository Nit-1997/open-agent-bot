"use client";

import { FileText } from "lucide-react";
import { useState } from "react";
import { reportThumbHref } from "../../lib/reports.ts";

export function ReportThumb(props: { id: string; reportId: string; tall: boolean }) {
  const { id, reportId } = props;
  const [failed, setFailed] = useState<string | null>(null);
  const height = props.tall ? "h-[150px]" : "h-32";
  return (
    <span id={id} aria-hidden="true" className={`relative block w-full overflow-hidden bg-white ${height}`}>
      {failed === reportId ? (
        <span
          id={`${id}-fallback`}
          style={{ background: "var(--accent-gradient)" }}
          className="flex h-full w-full items-center justify-center text-mist-600"
        >
          <FileText id={`${id}-fallback-icon`} aria-hidden="true" size={28} />
        </span>
      ) : (
        <img
          id={`${id}-img`}
          src={reportThumbHref(reportId)}
          alt=""
          loading="lazy"
          decoding="async"
          width={1200}
          height={480}
          onError={() => setFailed(reportId)}
          className="h-full w-full object-cover object-top"
        />
      )}
    </span>
  );
}

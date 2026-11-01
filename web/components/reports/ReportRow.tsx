import type { ReportSummary } from "@shared/lists";
import { Download, FileText } from "lucide-react";
import Link from "next/link";
import { UNTITLED } from "@/components/chat/ChatHeader";
import { shortDate } from "@/lib/dates";
import { reportPdfHref } from "@/lib/reports";

export const fromChat = (r: Pick<ReportSummary, "chatId" | "chatTitle">) =>
  r.chatId === null ? "Chat deleted" : r.chatTitle?.trim() || UNTITLED;

const action =
  "inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12px] font-medium text-text-secondary transition hover:border-border-strong hover:text-text-primary";

export function ReportRow({ id, report }: { id: string; report: ReportSummary }) {
  return (
    <li id={id} className="flex flex-col gap-3 rounded-2xl border border-surface-accent bg-surface p-4">
      <div id={`${id}-head`} className="flex items-start gap-3">
        <span
          id={`${id}-thumb`}
          aria-hidden="true"
          style={{ background: "var(--accent-gradient)" }}
          className="flex h-11 w-9 shrink-0 items-center justify-center rounded-md border border-border text-mist-600"
        >
          <FileText id={`${id}-thumb-icon`} aria-hidden="true" size={16} />
        </span>
        <div id={`${id}-text`} className="min-w-0 flex-1">
          <h2 id={`${id}-title`} title={report.title} className="line-clamp-2 text-[15px] font-semibold leading-snug text-text-primary">
            <bdi id={`${id}-title-bdi`}>{report.title}</bdi>
          </h2>
          <p id={`${id}-meta`} className="mt-1 text-[12px] text-text-muted">
            {`Report · ${shortDate(report.createdAt)}`}
          </p>
          <p id={`${id}-chat`} className="mt-0.5 truncate text-[12px] text-text-muted" title={fromChat(report)}>
            {"From "}
            <bdi id={`${id}-chat-bdi`}>{fromChat(report)}</bdi>
          </p>
        </div>
      </div>
      <div id={`${id}-actions`} className="mt-auto flex flex-wrap gap-2">
        <Link id={`${id}-open`} href={`/reports/${report.id}`} className={action}>
          Open
        </Link>
        <a id={`${id}-pdf`} href={reportPdfHref(report.id)} download className={action}>
          <Download id={`${id}-pdf-icon`} aria-hidden="true" size={13} />
          Download PDF
        </a>
      </div>
    </li>
  );
}

"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { ReportViewer } from "./ReportViewer";

export function BackLink(props: { id: string; href: string; label: string }) {
  return (
    <Link
      id={props.id}
      href={props.href}
      className="inline-flex w-fit items-center gap-1.5 text-[13px] text-text-muted hover:text-text-primary"
    >
      <ArrowLeft id={`${props.id}-icon`} aria-hidden="true" size={14} />
      {props.label}
    </Link>
  );
}

export function ReportDetail({ reportId }: { reportId: string }) {
  const id = "report-detail";
  return (
    <ReportViewer id={id} reportId={reportId} variant="page" back={<BackLink id={`${id}-back`} href="/reports" label="All reports" />} />
  );
}

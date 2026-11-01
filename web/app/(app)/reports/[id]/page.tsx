import { ARTIFACT_ID_RE } from "@shared/artifacts";
import { notFound } from "next/navigation";
import { ReportDetail } from "@/components/reports/ReportDetail";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ARTIFACT_ID_RE.test(id)) notFound();
  return <ReportDetail key={id} reportId={id} />;
}

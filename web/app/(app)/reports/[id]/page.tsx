import { ARTIFACT_ID_RE } from "@oab/shared/artifacts";
import { RouteView } from "@oab/ui/views/RouteView.tsx";
import { notFound } from "next/navigation";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ARTIFACT_ID_RE.test(id)) notFound();
  return <RouteView route={{ section: "report", id }} />;
}

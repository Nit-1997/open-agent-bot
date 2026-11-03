import { parsePage } from "@oab/shared/pages";
import { ReportsView } from "@oab/ui/components/reports/ReportsView.tsx";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const raw = (await searchParams).page;
  return <ReportsView page={parsePage(Array.isArray(raw) ? raw[0] : raw) ?? 1} />;
}

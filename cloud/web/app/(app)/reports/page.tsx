import { parsePage } from "@oab/shared/pages";
import { RouteView } from "@oab/ui/views/RouteView.tsx";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  const raw = (await searchParams).page;
  return <RouteView route={{ section: "reports", page: parsePage(Array.isArray(raw) ? raw[0] : raw) ?? 1 }} />;
}

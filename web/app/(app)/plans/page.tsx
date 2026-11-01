import { parsePage } from "@shared/pages";
import { isEntityKind } from "@shared/workspace";
import { PlansView } from "@/components/plans/PlansView";

type Search = Promise<{ page?: string | string[]; kind?: string | string[] }>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PlansPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const kind = first(params.kind);
  return <PlansView page={parsePage(first(params.page)) ?? 1} kind={isEntityKind(kind) ? kind : null} />;
}

import { isSearchScope } from "@oab/shared/lists";
import { parsePage } from "@oab/shared/pages";
import { RouteView } from "@oab/ui/views/RouteView.tsx";

type Search = Promise<{ q?: string | string[]; scope?: string | string[]; page?: string | string[] }>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function SearchPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const scope = first(params.scope);
  return (
    <RouteView
      route={{
        section: "search",
        q: first(params.q) ?? "",
        scope: isSearchScope(scope) ? scope : "all",
        page: parsePage(first(params.page)) ?? 1,
      }}
    />
  );
}

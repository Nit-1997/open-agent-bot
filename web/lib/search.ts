import type { SearchResponse, SearchScope } from "@shared/lists";
import { readApi } from "@/lib/api";

export const searchApi = {
  search: async (q: string, scope: SearchScope, page: number, signal?: AbortSignal) => {
    const params = new URLSearchParams({ q, scope, page: String(page) });
    return readApi<SearchResponse>(await fetch(`/api/search?${params}`, { cache: "no-store", signal }));
  },
};

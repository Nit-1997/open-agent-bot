import { api } from "../platform/api.ts";
import type { SearchResponse, SearchScope } from "@oab/shared/lists";
import { readApi } from "./api.ts";

export const searchApi = {
  search: async (q: string, scope: SearchScope, page: number, signal?: AbortSignal) => {
    const params = new URLSearchParams({ q, scope, page: String(page) });
    return readApi<SearchResponse>(await api().fetch(`/search?${params}`, { cache: "no-store", signal }));
  },
};

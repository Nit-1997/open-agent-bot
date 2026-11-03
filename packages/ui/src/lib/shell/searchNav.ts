import { SEARCH_MAX, type SearchScope } from "@oab/shared/lists";

export function searchHref(raw: string, scope: SearchScope = "all", page = 1): string {
  const params = new URLSearchParams();
  const q = raw.slice(0, SEARCH_MAX);
  if (q) params.set("q", q);
  if (scope !== "all") params.set("scope", scope);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/search?${qs}` : "/search";
}

export const SEARCH_DEBOUNCE_MS = 250;

export const SEARCH_FIELD_ID = "search-field";
export const SEARCH_INPUT_ID = `${SEARCH_FIELD_ID}-input`;

"use client";

import { normalizeQuery, SEARCH_MIN, type SearchResponse, type SearchScope } from "@oab/shared/lists";
import { useNavigate } from "../../platform/index.ts";
import { useEffect, useRef, useState } from "react";
import { useShell } from "../shell/ShellProvider.tsx";
import { SidebarSearch } from "../shell/SidebarSearch.tsx";
import { ListState } from "../ui/ListState.tsx";
import { Pager } from "../ui/Pager.tsx";
import { SectionHeader } from "../ui/SectionHeader.tsx";
import { SectionPage } from "../ui/SectionPage.tsx";
import { errorMessage } from "../../lib/errors.ts";
import { searchApi } from "../../lib/search.ts";
import { SEARCH_FIELD_ID, searchHref } from "../../lib/shell/searchNav.ts";
import { hitKey, SearchHitRow } from "./SearchHitRow";
import { SearchScopeTabs } from "./SearchScopeTabs";

type Result = { key: string; data?: SearchResponse; error?: string };
type MountFocus = "input" | "header" | "keep";

const typingInSearch = () => typeof document !== "undefined" && !!document.activeElement?.closest("form[role=search]");

export function SearchView(props: { q: string; scope: SearchScope; page: number }) {
  const id = "search";
  const router = useNavigate();
  const { takeFocusRequest } = useShell();
  const input = useRef<HTMLInputElement>(null);
  const [mountFocus] = useState<MountFocus>(() => (takeFocusRequest("search") ? "input" : typingInSearch() ? "keep" : "header"));
  const query = normalizeQuery(props.q);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const key = `${query}|${props.scope}|${props.page}|${attempt}`;

  useEffect(() => {
    if (mountFocus === "input") input.current?.focus();
  }, [mountFocus]);

  useEffect(() => {
    if (!query) return;
    const ac = new AbortController();
    searchApi
      .search(query, props.scope, props.page, ac.signal)
      .then((data) => {
        if (ac.signal.aborted) return;
        const last = Math.max(1, Math.ceil(data.total / data.pageSize));
        if (!data.items.length && props.page > last) router.replace(searchHref(props.q, props.scope, last));
        setResult({ key, data });
      })
      .catch((e: unknown) => {
        if (!ac.signal.aborted) setResult({ key, error: errorMessage(e) });
      });
    return () => ac.abort();
  }, [key, query, props.scope, props.page, props.q, router]);

  const current = result?.key === key ? result : null;
  const data = current?.data;
  const setScope = (scope: SearchScope) => router.replace(searchHref(props.q, scope));

  return (
    <SectionPage id={id}>
      <SectionHeader id={`${id}-header`} title="Search" focusOnMount={mountFocus === "header"} />
      <div id={`${id}-controls`} className="flex flex-col gap-4 pb-4">
        <SidebarSearch id={SEARCH_FIELD_ID} placeholder="Search chats and reports" large inputRef={input} />
        <SearchScopeTabs id={`${id}-scopes`} value={props.scope} counts={data?.counts} onChange={setScope} />
      </div>
      <div id={`${id}-scopes-panel`} role="tabpanel" aria-labelledby={`${id}-scopes-${props.scope}`}>
        {!query && <ListState id={`${id}-hint`} state={{ kind: "empty", children: `Type at least ${SEARCH_MIN} characters to search.` }} />}
        {query && !current && <ListState id={`${id}-loading`} state={{ kind: "loading", rows: 4 }} />}
        {query && current?.error && (
          <ListState
            id={`${id}-error`}
            state={{ kind: "error", message: `Couldn't search: ${current.error}`, onRetry: () => setAttempt((a) => a + 1) }}
          />
        )}
        {query && data && data.total === 0 && (
          <ListState id={`${id}-empty`} state={{ kind: "empty", children: `No chats or reports match “${query}”.` }} />
        )}
        {query && data && data.items.length > 0 && (
          <>
            <ul id={`${id}-results`} className="flex flex-col gap-1">
              {data.items.map((hit) => (
                <SearchHitRow key={hitKey(hit)} id={`${id}-hit-${hitKey(hit)}`} hit={hit} query={query} />
              ))}
            </ul>
            <Pager
              id={`${id}-pager`}
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPage={(p) => router.push(searchHref(props.q, props.scope, p))}
            />
          </>
        )}
      </div>
    </SectionPage>
  );
}

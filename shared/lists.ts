import type { PageResponse } from "./pages.ts";

export const CHATS_PAGE_SIZE = 20;
export const REPORTS_PAGE_SIZE = 12;
export const SEARCH_PAGE_SIZE = 10;
export const SEARCH_MIN = 3;
export const SEARCH_MAX = 100;
export const SEARCH_RAW_MAX = 400;
export const SEARCH_MAX_OFFSET = 10_000;
export const SNIPPET_CHARS = 180;
export const SEARCH_SCOPES = ["all", "chats", "reports"] as const;
export type SearchScope = (typeof SEARCH_SCOPES)[number];

export const isSearchScope = (v: unknown): v is SearchScope => typeof v === "string" && (SEARCH_SCOPES as readonly string[]).includes(v);

export type ReportSummary = {
  id: string;
  title: string;
  createdAt: string;
  chatId: string | null;
  chatTitle: string | null;
  pdfReady: boolean;
  sizeBytes: number;
};

export type Snippet = { text: string; truncatedStart: boolean; truncatedEnd: boolean };

export type SearchHit =
  | { kind: "chat"; chatId: string; title: string; at: string; match: "title" | "message"; snippet: Snippet | null }
  | { kind: "report"; id: string; title: string; at: string; chatId: string | null; chatTitle: string | null };

export type SearchResponse = PageResponse<SearchHit> & {
  query: string;
  scope: SearchScope;
  counts: { chats: number; reports: number };
};

const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;

export function normalizeQuery(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > SEARCH_RAW_MAX) return null;
  const q = raw.replace(INVISIBLE, "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  const n = Array.from(q).length;
  return n >= SEARCH_MIN && n <= SEARCH_MAX ? q : null;
}

export const searchOffsetOk = (page: number) => (page - 1) * SEARCH_PAGE_SIZE <= SEARCH_MAX_OFFSET;

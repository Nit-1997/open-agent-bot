import type { DatabaseSync } from "node:sqlite";
import {
  SEARCH_MAX,
  SEARCH_MAX_OFFSET,
  SEARCH_MIN,
  SEARCH_PAGE_SIZE,
  type SearchScope,
  isSearchScope,
  SNIPPET_CHARS,
} from "@oab/shared/lists";
import { UserError } from "../../lib/errors.js";
import type { SearchResult, SearchRow } from "../../store/types.js";
import type { Ctx } from "./repos.js";

const SEARCH_DB_MIN = 2;
const SEARCH_DB_MAX = 100;
const SNIPPET_LEAD = 60;

export const caseFold = (text: string): string => text.toLowerCase();

export function registerSearchFunctions(db: DatabaseSync): void {
  db.function("oab_contains", { deterministic: true, varargs: false }, (haystack, needle) =>
    typeof haystack === "string" && typeof needle === "string" && caseFold(haystack).includes(caseFold(needle)) ? 1 : 0,
  );
}

export const SEARCH_SQL = `WITH message_hits AS (
  SELECT m.chat_id, m.content FROM chat_messages m
  WHERE m.id IN (
    SELECT max(id) FROM chat_messages WHERE user_id = :user AND oab_contains(content, :needle) GROUP BY chat_id
  )
),
hits AS MATERIALIZED (
  SELECT 'chat' AS kind, c.id AS ref_id, c.title, c.last_message_at AS occurred_at, c.id AS chat_id,
         CASE WHEN oab_contains(c.title, :needle) THEN 'title' ELSE 'message' END AS match_kind, mh.content
  FROM chats c LEFT JOIN message_hits mh ON mh.chat_id = c.id
  WHERE c.user_id = :user AND (oab_contains(c.title, :needle) OR mh.chat_id IS NOT NULL)
  UNION ALL
  SELECT 'report', a.id, a.title, a.created_at, a.chat_id, 'title', NULL
  FROM artifacts a
  WHERE a.user_id = :user AND oab_contains(a.title, :needle)
),
scoped AS (
  SELECT * FROM hits
  WHERE :scope = 'all' OR (:scope = 'chats' AND kind = 'chat') OR (:scope = 'reports' AND kind = 'report')
)
SELECT (SELECT count(*) FROM scoped) AS total,
       (SELECT count(*) FROM hits WHERE kind = 'chat') AS chats,
       (SELECT count(*) FROM hits WHERE kind = 'report') AS reports,
       p.kind, p.ref_id, p.title, p.occurred_at, p.chat_id, p.match_kind, p.content
FROM (SELECT 1) AS one
LEFT JOIN (SELECT * FROM scoped ORDER BY occurred_at DESC, ref_id DESC LIMIT :limit OFFSET :offset) AS p ON 1
ORDER BY p.occurred_at DESC, p.ref_id DESC`;

type Row = {
  total: number;
  chats: number;
  reports: number;
  kind: "chat" | "report" | null;
  ref_id: string;
  title: string;
  occurred_at: string;
  chat_id: string | null;
  match_kind: "title" | "message";
  content: string | null;
};

export function snippetOf(content: string, query: string): { snippet: string; snippetStart: number; contentLength: number } {
  const folded = caseFold(content);
  const unit = folded.indexOf(caseFold(query));
  const position = unit < 0 ? 0 : Array.from(folded.slice(0, unit)).length + 1;
  const start = Math.max(1, position - SNIPPET_LEAD);
  const chars = Array.from(content);
  return { snippet: chars.slice(start - 1, start - 1 + SNIPPET_CHARS).join(""), snippetStart: start, contentLength: chars.length };
}

const invalidQuery = () => new UserError(`Search for ${SEARCH_MIN} to ${SEARCH_MAX} characters.`, "invalid");

export function searchUser(ctx: Ctx, userId: string, query: string, scope: SearchScope, page: number): SearchResult {
  const length = typeof query === "string" ? Array.from(query).length : 0;
  if (length < SEARCH_DB_MIN || length > SEARCH_DB_MAX || !isSearchScope(scope)) throw invalidQuery();
  const offset = (Math.max(1, Math.floor(page)) - 1) * SEARCH_PAGE_SIZE;
  if (!Number.isFinite(offset) || offset > SEARCH_MAX_OFFSET) throw invalidQuery();
  const rows = ctx.stmt(SEARCH_SQL).all({ user: userId, needle: query, scope, limit: SEARCH_PAGE_SIZE, offset }) as Row[];
  const head = rows[0];
  const items: SearchRow[] = rows.flatMap((r) => {
    if (r.kind === null) return [];
    const snip = r.content === null ? null : snippetOf(r.content, query);
    return [
      {
        kind: r.kind,
        refId: r.ref_id,
        title: r.title,
        at: r.occurred_at,
        chatId: r.chat_id,
        match: r.match_kind,
        snippet: snip?.snippet ?? null,
        snippetStart: snip?.snippetStart ?? null,
        contentLength: snip?.contentLength ?? null,
      },
    ];
  });
  return { total: Number(head?.total ?? 0), chats: Number(head?.chats ?? 0), reports: Number(head?.reports ?? 0), items };
}

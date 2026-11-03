export const PAGE_SIZE = 5;
const MAX_PAGE = 100_000;

export type Page<T> = { items: T[]; total: number };

export type PageResponse<T> = Page<T> & { page: number; pageSize: number };

export function parsePage(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return 1;
  const text = String(raw);
  if (!/^\d{1,6}$/.test(text)) return null;
  const page = Number(text);
  return page >= 1 && page <= MAX_PAGE ? page : null;
}

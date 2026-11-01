export const PAGE_SIZE = 5;
const MAX_PAGE = 100_000;

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

export function parsePage(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return 1;
  const text = String(raw);
  if (!/^\d{1,6}$/.test(text)) return null;
  const page = Number(text);
  return page >= 1 && page <= MAX_PAGE ? page : null;
}

export function rangeText(page: number, pageSize: number, total: number): string {
  if (total <= 0) return "Showing 0 of 0";
  const first = Math.min((page - 1) * pageSize + 1, total);
  const last = Math.min(page * pageSize, total);
  return `Showing ${first}–${last} of ${total}`;
}

export function pageCount(pageSize: number, total: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

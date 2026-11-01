export function rangeText(page: number, pageSize: number, total: number): string {
  if (total <= 0) return "Showing 0 of 0";
  const first = Math.min((page - 1) * pageSize + 1, total);
  const last = Math.min(page * pageSize, total);
  return `Showing ${first}–${last} of ${total}`;
}

export function pageCount(pageSize: number, total: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

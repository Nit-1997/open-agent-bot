export type DateGroup = "today" | "week" | "earlier";

export const DATE_GROUP_LABEL: Record<DateGroup, string> = { today: "Today", week: "This week", earlier: "Earlier" };
export const DATE_GROUPS: readonly DateGroup[] = ["today", "week", "earlier"];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function groupByDate(iso: string, now: Date = new Date()): DateGroup {
  const at = new Date(iso);
  const today = startOfDay(now);
  if (at >= today) return "today";
  const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
  return at >= weekStart ? "week" : "earlier";
}

export function groupItems<T>(
  items: readonly T[],
  at: (item: T) => string,
  now: Date = new Date(),
): Array<{ group: DateGroup; items: T[] }> {
  const groups = new Map<DateGroup, T[]>();
  for (const item of items) {
    const g = groupByDate(at(item), now);
    groups.set(g, [...(groups.get(g) ?? []), item]);
  }
  return DATE_GROUPS.flatMap((group) => (groups.has(group) ? [{ group, items: groups.get(group)! }] : []));
}

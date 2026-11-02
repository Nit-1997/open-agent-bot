export function shortDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown date";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() && { year: "numeric" }),
  });
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const minutes = Math.round((now.getTime() - d.getTime()) / 60_000);
  if (Number.isNaN(minutes)) return "at an unknown time";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return `on ${shortDate(iso, now)}`;
}

export function cardDate(iso: string | null | undefined, locale?: string, now: Date = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() && { year: "numeric" }),
  });
}

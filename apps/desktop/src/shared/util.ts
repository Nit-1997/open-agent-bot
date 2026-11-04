const KB = 1024;
const MB = 1024 ** 2;
const GB = 1024 ** 3;

export const obj = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

export const lastLines = (text: string, n: number) => text.split(/\r?\n/).filter(Boolean).slice(-n).join("\n");

export const formatBytes = (n: number) =>
  n >= GB ? `${(n / GB).toFixed(1)} GB` : n >= MB ? `${Math.round(n / MB)} MB` : n > 0 ? `${Math.max(1, Math.ceil(n / KB))} KB` : "0 KB";

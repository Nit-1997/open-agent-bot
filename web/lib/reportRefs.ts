import type { Turn } from "./turns";

export type ReportRef = { reportId: string; toolCallId: string; title: string };

export const REPORT_TOOLS: ReadonlySet<string> = new Set(["create_artifact", "research"]);

export function parseArtifactId(result: string | undefined): string | null {
  const m = /artifact ([A-Za-z0-9_-]{12}) created/.exec(result ?? "");
  return m ? m[1] : null;
}

export function reportTitleIn(result: string | undefined): string | null {
  return /artifact [A-Za-z0-9_-]{12} created: ([^\n]+)/.exec(result ?? "")?.[1]?.trim() || null;
}

export function reportsIn(turns: readonly Turn[]): ReportRef[] {
  const seen = new Set<string>();
  const out: ReportRef[] = [];
  for (const t of turns)
    for (const it of t.items) {
      if (it.kind !== "artifact") continue;
      const reportId = parseArtifactId(it.result);
      if (!reportId || seen.has(reportId)) continue;
      seen.add(reportId);
      out.push({ reportId, toolCallId: it.id, title: it.title });
    }
  return out;
}

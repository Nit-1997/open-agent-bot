export type LogsView = Readonly<{ service: "all" | "agent" | "search" | "renderer"; requestsOnly: boolean }>;

export const LOG_SERVICES = ["all", "agent", "search", "renderer"] as const;
const PREFIX = /^([a-z][a-z0-9_-]*?)-\d+\s+\|/;

export function filterLogs(text: string, view: LogsView): string {
  const lines = text.split(/\r?\n/).filter((l) => {
    if (!l) return false;
    if (view.requestsOnly && !l.includes("[http]")) return false;
    if (view.service !== "all" && PREFIX.exec(l)?.[1] !== view.service) return false;
    return true;
  });
  return lines.length > 0 ? lines.join("\n") : "(no matching lines)";
}

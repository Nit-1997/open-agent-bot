import type { ServiceInfoRow } from "../shared/actions.ts";
import { type ContainerInspect, SERVICES } from "./compose.ts";

const LABELS: Readonly<Record<string, string>> = { agent: "agent", search: "search (SearXNG)", renderer: "renderer" };

export function serviceStateText(c: Pick<ContainerInspect, "status" | "health" | "exitCode"> | undefined): string {
  if (!c) return "missing";
  switch (c.status) {
    case "running":
      if (c.health === "unhealthy") return "unhealthy";
      return c.health ? `running · ${c.health}` : "running";
    case "restarting":
      return "restarting";
    default:
      return `exited (${c.exitCode})`;
  }
}

export function serviceInfoRows(containers: readonly ContainerInspect[]): ServiceInfoRow[] {
  return SERVICES.map((service) => {
    const c = containers.find((x) => x.service === service);
    return { service, label: LABELS[service] ?? service, state: serviceStateText(c), version: c?.version ?? "—" };
  });
}

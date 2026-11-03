import { type ContainerInspect, SERVICES, type ServiceName } from "./compose.ts";
import type { Health } from "./health.ts";
import { type StackFile, tokensEqual } from "./launchToken.ts";
import { isRefusalExit } from "./refusals.ts";
import type { ServicePins } from "./services.ts";

export type Existing = "none" | "oursRunning" | "oursStopped" | "oursStale" | "foreign";

export type ClassifyInput = Readonly<{
  containers: readonly ContainerInspect[];
  stored?: StackFile;
  stagedComposePath: string;
  pins: ServicePins;
  expectedImageIds: Readonly<Partial<Record<"agent" | "search", string>>>;
  health?: Health;
}>;

const CLEAN_EXIT = new Set([0, 137, 143]);
const STOPPED = new Set(["exited", "created"]);

const imageFor = (pins: ServicePins, s: ServiceName) => (s === "search" ? pins.images.search : pins.images.agent);
const idFor = (ids: ClassifyInput["expectedImageIds"], s: ServiceName) => (s === "search" ? ids.search : ids.agent);

export function versionMatches(pins: ServicePins, version: string | undefined): boolean {
  return pins.version === "dev" || version === pins.version;
}

export function classify(i: ClassifyInput): { kind: Existing; reasons: string[] } {
  if (i.containers.length === 0) return { kind: "none", reasons: [] };
  if (i.containers.some((c) => c.configFiles !== i.stagedComposePath)) return { kind: "foreign", reasons: ["config_files"] };

  const reasons: string[] = [];
  const by = new Map<string, ContainerInspect>();
  for (const c of i.containers) by.set(c.service, c);
  const agent = by.get("agent");

  if (!agent || !tokensEqual(agent.token, i.stored?.launchToken)) reasons.push("token_mismatch");
  for (const s of SERVICES) {
    const c = by.get(s);
    if (!c) {
      reasons.push(`partial(${s} missing)`);
      continue;
    }
    if (c.image !== imageFor(i.pins, s)) reasons.push(`image_mismatch(${s})`);
    const want = idFor(i.expectedImageIds, s);
    if (!want || c.imageId !== want) reasons.push(`image_id_mismatch(${s})`);
  }
  if (agent && (i.stored?.port === undefined || agent.port !== i.stored.port)) reasons.push("port_mismatch");
  if (agent && isRefusalExit(agent.exitCode) && agent.status !== "running") reasons.push(`refused(${agent.exitCode})`);
  if (reasons.length > 0) return { kind: "oursStale", reasons };

  const all = SERVICES.map((s) => by.get(s)!);
  if (all.every((c) => c.status === "running")) {
    if (agent?.health !== "healthy") return { kind: "oursStale", reasons: [`unhealthy(agent ${agent?.health ?? "none"})`] };
    if (!i.health?.ok || i.health.app !== "open-agent") return { kind: "oursStale", reasons: ["health"] };
    if (!versionMatches(i.pins, i.health.version)) return { kind: "oursStale", reasons: ["health_version"] };
    return { kind: "oursRunning", reasons: [] };
  }
  if (all.every((c) => STOPPED.has(c.status) && CLEAN_EXIT.has(c.exitCode))) return { kind: "oursStopped", reasons: [] };
  const odd = all.filter((c) => c.status !== "running").map((c) => `${c.service} ${c.status}${c.exitCode ? ` ${c.exitCode}` : ""}`);
  return { kind: "oursStale", reasons: [`partial(${odd.join(", ")})`] };
}

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Log } from "./logger.ts";
import { effectivePins, type ServicePins, validatePins } from "./services.ts";
import { bundledComposeSha } from "./stackFiles.ts";
import type { PinsLoad } from "./stackManager.ts";
import { readStateFile, writeStateFile } from "./statePaths.ts";

export type PinsSource = Readonly<{
  bundledDir: string;
  servicesOverride?: string;
  servicesFile: string;
  test: boolean;
  shellVersion: string;
  log: Log;
}>;

const obj = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

const manifestOf = (p: ServicePins) => ({
  schema: 1,
  kind: p.kind,
  version: p.version,
  composeSha256: p.composeSha256,
  images: { agent: p.images.agent, search: p.images.search },
  pull: p.pull,
  ...(p.minShellVersion ? { minShellVersion: p.minShellVersion } : {}),
});

export function writeAcceptedServices(file: string, pins: ServicePins, replaced: string | undefined, now: Date = new Date()): void {
  writeStateFile(file, { schema: 1, acceptedAt: now.toISOString(), ...(replaced ? { replaced } : {}), manifest: manifestOf(pins) });
}

function readAccepted(o: PinsSource, ctx: { test: boolean; composeSha256: string; shellVersion: string }): ServicePins | undefined {
  const r = readStateFile(o.servicesFile, (v) => {
    const rec = obj(v);
    return rec?.schema === 1 && obj(rec.manifest) ? rec.manifest : undefined;
  });
  if (r.problem) {
    if (r.problem !== "missing") o.log.warn(`[update] services.json ignored: ${r.problem}`);
    return undefined;
  }
  const v = validatePins(r.value, ctx);
  if (!v.ok) {
    o.log.warn(`[update] services.json ignored: ${v.reason}`);
    return undefined;
  }
  if (v.pins.kind === "local") {
    o.log.warn("[update] services.json ignored: local");
    return undefined;
  }
  return v.pins;
}

export function loadPins(o: PinsSource): PinsLoad {
  if (!existsSync(join(o.bundledDir, "docker-compose.yml"))) return { ok: false, reason: "stack_missing" };
  const ctx = { test: o.test, composeSha256: bundledComposeSha(o.bundledDir), shellVersion: o.shellVersion };
  const source = o.test && o.servicesOverride ? o.servicesOverride : join(o.bundledDir, "services.lock.json");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(source, "utf8"));
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const bundled = validatePins(raw, ctx);
  if (!bundled.ok) return bundled;
  const pins = effectivePins(bundled.pins, readAccepted(o, ctx));
  return pins ? { ok: true, pins } : { ok: false, reason: "no_pins" };
}

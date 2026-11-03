export type PullProgress = Readonly<{
  ref: string;
  layersDone: number;
  layersTotal: number;
  bytesDone?: number;
  bytesTotal?: number;
  done: boolean;
}>;

const LAYER = /^([0-9a-f]{12}): (.+)$/;
const DONE = new Set(["Pull complete", "Already exists"]);

export function createPullParser(
  ref: string,
  layerSizes?: ReadonlyMap<string, number>,
): { line(l: string): PullProgress; current(): PullProgress; finish(): PullProgress } {
  const seen = new Set<string>();
  const done = new Set<string>();
  let finished = false;
  const bytesTotal = layerSizes && layerSizes.size > 0 ? [...layerSizes.values()].reduce((a, b) => a + b, 0) : undefined;
  const current = (): PullProgress => {
    const layersTotal = Math.max(seen.size, layerSizes?.size ?? 0);
    const bytesDone = bytesTotal === undefined ? undefined : [...done].reduce((a, id) => a + (layerSizes?.get(id) ?? 0), 0);
    return {
      ref,
      layersDone: finished ? layersTotal : done.size,
      layersTotal,
      ...(bytesTotal === undefined ? {} : { bytesDone: finished ? bytesTotal : Math.min(bytesDone ?? 0, bytesTotal), bytesTotal }),
      done: finished,
    };
  };
  return {
    line: (raw) => {
      const l = raw.trim();
      const m = LAYER.exec(l);
      if (m) {
        const id = m[1]!;
        const status = m[2]!.trim();
        seen.add(id);
        if (DONE.has(status)) done.add(id);
      } else if (/^Status: (Downloaded newer image|Image is up to date)/.test(l)) {
        finished = true;
      }
      return current();
    },
    current,
    finish: () => {
      finished = true;
      return current();
    },
  };
}

const obj = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

export function layerSizesFromManifest(stdout: string, arch: string): Map<string, number> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const want = arch === "x86_64" ? "amd64" : arch === "aarch64" ? "arm64" : arch;
  for (const e of entries) {
    const r = obj(e);
    const platform = obj(obj(r?.Descriptor)?.platform);
    if (!r || (platform && (platform.os !== "linux" || platform.architecture !== want))) continue;
    if (!platform && entries.length > 1) continue;
    const manifest = obj(r.OCIManifest) ?? obj(r.SchemaV2Manifest);
    const layers = Array.isArray(manifest?.layers) ? manifest.layers : [];
    const sizes = new Map<string, number>();
    for (const layer of layers) {
      const l = obj(layer);
      const digest = typeof l?.digest === "string" ? l.digest : "";
      if (/^sha256:[0-9a-f]{64}$/.test(digest) && typeof l?.size === "number") sizes.set(digest.slice(7, 19), l.size);
    }
    return sizes.size > 0 ? sizes : undefined;
  }
  return undefined;
}

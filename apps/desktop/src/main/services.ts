export type PinsKind = "release" | "local" | "dev";
export type ServicePins = Readonly<{
  kind: PinsKind;
  version: string;
  composeSha256: string;
  images: Readonly<{ agent: string; search: string }>;
  imageIds?: Readonly<{ agent: string; search: string }>;
  pull: boolean;
  minShellVersion?: string;
}>;

export type PinsResult = { ok: true; pins: ServicePins } | { ok: false; reason: string };

const RELEASE_AGENT = /^ghcr\.io\/nit-1997\/open-agent@sha256:[0-9a-f]{64}$/;
const RELEASE_SEARCH = /^ghcr\.io\/nit-1997\/open-agent-search@sha256:[0-9a-f]{64}$/;
const TEST_TAG = /^(oab-[a-z0-9-]+|open-agent|open-agent-search):[A-Za-z0-9._-]+$/;
const TEST_REGISTRY = /^127\.0\.0\.1:18\d{3}\/oab-[a-z0-9-]+@sha256:[0-9a-f]{64}$/;
const LOCAL_REFS = { agent: "open-agent:local", search: "open-agent-search:local" } as const;
const TEST_LOCAL = /^oab-[a-z0-9-]+:local$/;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;
const SHA = /^[0-9a-f]{64}$/;

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseSemver(v: string): { core: [number, number, number]; pre?: string } | undefined {
  const m = SEMVER.exec(v);
  if (!m) return undefined;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], ...(m[4] ? { pre: m[4] } : {}) };
}

export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) return a === b ? 0 : a < b ? -1 : 1;
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i]! < y.core[i]! ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (x.pre === undefined) return 1;
  if (y.pre === undefined) return -1;
  return x.pre < y.pre ? -1 : 1;
}

const obj = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

export function validatePins(v: unknown, ctx: { test: boolean; composeSha256: string; shellVersion: string }): PinsResult {
  const r = obj(v);
  if (!r) return { ok: false, reason: "not_an_object" };
  if (r.schema !== 1) return { ok: false, reason: "schema" };
  const kind = r.kind === undefined ? "dev" : r.kind;
  if (kind !== "release" && kind !== "local" && kind !== "dev") return { ok: false, reason: "kind" };
  if (typeof r.version !== "string" || !VERSION.test(r.version)) return { ok: false, reason: "version" };
  if (typeof r.composeSha256 !== "string" || !SHA.test(r.composeSha256)) return { ok: false, reason: "compose_sha256" };
  if (r.composeSha256 !== ctx.composeSha256) return { ok: false, reason: "compose_mismatch" };
  if (r.images === null) return { ok: false, reason: "no_pins" };
  const images = obj(r.images);
  const agent = images?.agent;
  const search = images?.search;
  if (!images || typeof agent !== "string" || typeof search !== "string" || Object.keys(images).length !== 2)
    return { ok: false, reason: "images" };
  let minShellVersion: string | undefined;
  if (r.minShellVersion !== undefined) {
    if (typeof r.minShellVersion !== "string" || !parseSemver(r.minShellVersion)) return { ok: false, reason: "min_shell_version" };
    if (parseSemver(ctx.shellVersion) && compareSemver(r.minShellVersion, ctx.shellVersion) > 0)
      return { ok: false, reason: "shell_too_old" };
    minShellVersion = r.minShellVersion;
  }
  const base = {
    version: r.version,
    composeSha256: r.composeSha256,
    images: { agent, search },
    ...(minShellVersion ? { minShellVersion } : {}),
  };

  if (kind === "release") {
    if (!RELEASE_AGENT.test(agent) || !RELEASE_SEARCH.test(search)) return { ok: false, reason: "release_refs" };
    if (r.pull === false) return { ok: false, reason: "release_pull" };
    return { ok: true, pins: { kind, ...base, pull: true } };
  }

  if (kind === "local") {
    const refsOk = ctx.test
      ? (agent === LOCAL_REFS.agent || TEST_LOCAL.test(agent)) && (search === LOCAL_REFS.search || TEST_LOCAL.test(search))
      : agent === LOCAL_REFS.agent && search === LOCAL_REFS.search;
    if (!refsOk) return { ok: false, reason: "local_refs" };
    const ids = obj(r.imageIds);
    if (!ids || typeof ids.agent !== "string" || typeof ids.search !== "string" || !IMAGE_ID.test(ids.agent) || !IMAGE_ID.test(ids.search))
      return { ok: false, reason: "local_image_ids" };
    if (r.pull !== false) return { ok: false, reason: "local_pull" };
    return { ok: true, pins: { kind, ...base, imageIds: { agent: ids.agent, search: ids.search }, pull: false } };
  }

  if (!ctx.test) return { ok: false, reason: "dev_outside_test" };
  const refOk = (ref: string) => TEST_TAG.test(ref) || TEST_REGISTRY.test(ref);
  if (!refOk(agent) || !refOk(search)) return { ok: false, reason: "test_refs" };
  const pull = r.pull === undefined ? !TEST_TAG.test(agent) : r.pull === true;
  if (pull && (TEST_TAG.test(agent) || TEST_TAG.test(search))) return { ok: false, reason: "tag_pull" };
  return { ok: true, pins: { kind, ...base, pull } };
}

export function effectivePins(bundled: ServicePins | undefined, accepted: ServicePins | undefined): ServicePins | undefined {
  if (!accepted || bundled?.kind === "local") return bundled;
  if (!bundled) return accepted;
  return compareSemver(accepted.version, bundled.version) > 0 ? accepted : bundled;
}

export const isLocalBuild = (p: ServicePins | undefined) => p?.kind === "local";

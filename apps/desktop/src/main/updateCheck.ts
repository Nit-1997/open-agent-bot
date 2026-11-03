import { compareSemver, type ServicePins, validatePins } from "./services.ts";
import type { Settings } from "./settings.ts";
import { PRODUCTION } from "./shellConfig.ts";

export { incompatibleText } from "../shared/updateText.ts";
export { compareSemver };

const RELEASES = "https://github.com/Nit-1997/open-agent-bot/releases/";
export const RELEASE_API_URL = PRODUCTION.releasesUrl;
export const RELEASE_LIST_URL = RELEASES;
export const RELEASE_PAGE_PREFIX = RELEASES;
export const ASSET_PREFIX = `${RELEASES}download/`;
export const MANIFEST_ASSET = "open-agent-services.json";
export const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  "api.github.com",
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);
export const MAX_HOPS = 3;
export const TIMEOUT_MS = 5000;
export const MAX_RELEASE_BYTES = 1024 * 1024;
export const MAX_MANIFEST_BYTES = 64 * 1024;
export const CHECK_INTERVAL_MS = 24 * 3600 * 1000;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export type UpdateResult =
  | { ok: true; shell?: { version: string; pageUrl: string }; services?: ServicePins; incompatible?: string }
  | { ok: false; reason: string; detail?: string };
export type CheckDeps = Readonly<{
  fetch: FetchLike;
  url: string;
  shellVersion: string;
  services: ServicePins | undefined;
  composeSha256: string;
  test: boolean;
  timeoutMs?: number;
}>;

const TAG = /^v(\d+\.\d+\.\d+)$/;
const TEST_TAG = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]{0,31})?)$/;
const TEST_URL = /^http:\/\/127\.0\.0\.1:18\d{3}\//;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

type Policy = (u: URL) => boolean;
type Fetched = { ok: true; text: string } | { ok: false; reason: string; detail?: string };

const noUser = (u: URL) => !u.username && !u.password;
const githubPolicy: Policy = (u) => u.protocol === "https:" && ALLOWED_HOSTS.has(u.hostname) && u.port === "" && noUser(u);
const originPolicy =
  (origin: string): Policy =>
  (u) =>
    u.origin === origin && noUser(u);

const obj = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

const parseUrl = (raw: string, base?: string): URL | undefined => {
  try {
    return new URL(raw, base);
  } catch {
    return undefined;
  }
};

async function readCapped(res: Response, max: number): Promise<Uint8Array | undefined> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      void reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

async function getCapped(
  fetch: FetchLike,
  url: string,
  o: { policy: Policy; maxBytes: number; timeoutMs: number; headers: Record<string, string> },
): Promise<Fetched> {
  const signal = AbortSignal.timeout(o.timeoutMs);
  const failed = (e: unknown): Fetched => ({
    ok: false,
    reason: signal.aborted ? "timeout" : "offline",
    detail: e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 200) : String(e).slice(0, 200),
  });
  let current = url;
  for (let hop = 0; ; hop++) {
    let res: Response;
    try {
      res = await fetch(current, { method: "GET", headers: o.headers, redirect: "manual", credentials: "omit", cache: "no-store", signal });
    } catch (e) {
      return failed(e);
    }
    if (res.type === "opaqueredirect" || res.status === 0) return { ok: false, reason: "redirect_refused" };
    if (REDIRECTS.has(res.status)) {
      void res.body?.cancel().catch(() => {});
      const location = res.headers.get("location");
      const next = location ? parseUrl(location, current) : undefined;
      if (hop >= MAX_HOPS || !next || !o.policy(next)) return { ok: false, reason: "redirect_refused" };
      current = next.href;
      continue;
    }
    if (res.status === 403 || res.status === 429) {
      void res.body?.cancel().catch(() => {});
      return { ok: false, reason: "rate_limited" };
    }
    if (res.status < 200 || res.status > 299) {
      void res.body?.cancel().catch(() => {});
      return { ok: false, reason: `http_${res.status}` };
    }
    const declared = Number(res.headers.get("content-length") ?? Number.NaN);
    if (Number.isFinite(declared) && declared > o.maxBytes) {
      void res.body?.cancel().catch(() => {});
      return { ok: false, reason: "too_large" };
    }
    let bytes: Uint8Array | undefined;
    try {
      bytes = await readCapped(res, o.maxBytes);
    } catch (e) {
      return failed(e);
    }
    if (!bytes) return { ok: false, reason: "too_large" };
    return { ok: true, text: new TextDecoder().decode(bytes) };
  }
}

const parseJson = (text: string): Record<string, unknown> | undefined => {
  try {
    return obj(JSON.parse(text));
  } catch {
    return undefined;
  }
};

const pageUrlOf = (v: unknown): string => {
  if (typeof v !== "string" || !v.startsWith(RELEASE_PAGE_PREFIX)) return RELEASE_LIST_URL;
  return parseUrl(v)?.href === v ? v : RELEASE_LIST_URL;
};

function startPolicy(d: CheckDeps): Policy | undefined {
  const u = parseUrl(d.url);
  if (!u) return undefined;
  if (d.test) return TEST_URL.test(d.url) && noUser(u) ? originPolicy(u.origin) : undefined;
  return u.protocol === "https:" && u.hostname === "api.github.com" && u.port === "" && noUser(u) ? githubPolicy : undefined;
}

export async function checkForUpdates(d: CheckDeps): Promise<UpdateResult> {
  const policy = startPolicy(d);
  if (!policy) return { ok: false, reason: "url_refused" };
  const timeoutMs = d.timeoutMs ?? TIMEOUT_MS;
  const headers = { Accept: "application/vnd.github+json", "User-Agent": `OpenAgent/${d.shellVersion}` };

  const got = await getCapped(d.fetch, d.url, { policy, maxBytes: MAX_RELEASE_BYTES, timeoutMs, headers });
  if (!got.ok) return got;
  const rel = parseJson(got.text);
  if (!rel) return { ok: false, reason: "bad_json" };
  if (rel.draft === true || rel.prerelease === true) return { ok: false, reason: "not_final" };
  const tag = typeof rel.tag_name === "string" ? (d.test ? TEST_TAG : TAG).exec(rel.tag_name) : null;
  if (!tag?.[1]) return { ok: false, reason: "bad_tag" };
  const version = tag[1];

  const shell = compareSemver(version, d.shellVersion) > 0 ? { version, pageUrl: pageUrlOf(rel.html_url) } : undefined;
  const done = (extra: { services?: ServicePins; incompatible?: string } = {}): UpdateResult => ({
    ok: true,
    ...(shell ? { shell } : {}),
    ...extra,
  });

  const current = d.services;
  if (!current || current.kind === "local" || compareSemver(version, current.version) <= 0) return done();
  const asset = (Array.isArray(rel.assets) ? rel.assets : []).map(obj).find((a) => a?.name === MANIFEST_ASSET);
  if (!asset) return done();

  const raw = asset.browser_download_url;
  const assetUrl = typeof raw === "string" ? parseUrl(raw) : undefined;
  const assetOk = typeof raw === "string" && assetUrl?.href === raw && policy(assetUrl) && (d.test || raw.startsWith(ASSET_PREFIX));
  if (!assetUrl || !assetOk) return done({ incompatible: "asset_url" });

  const m = await getCapped(d.fetch, assetUrl.href, { policy, maxBytes: MAX_MANIFEST_BYTES, timeoutMs, headers });
  if (!m.ok) return done({ incompatible: `manifest_${m.reason}` });
  const manifest = parseJson(m.text);
  if (!manifest) return done({ incompatible: "manifest_bad_json" });
  if (manifest.version !== version) return done({ incompatible: "manifest_tag_mismatch" });
  if (manifest.kind === "local") return done({ incompatible: "manifest_kind" });
  if (manifest.minShellVersion === undefined) return done({ incompatible: "min_shell_version" });
  const v = validatePins(manifest, { test: d.test, composeSha256: d.composeSha256, shellVersion: d.shellVersion });
  if (!v.ok) return done({ incompatible: v.reason });
  return done({ services: v.pins });
}

export function shouldAutoCheck(s: Pick<Settings, "checkForUpdates" | "lastUpdateCheck">, now: number): boolean {
  if (!s.checkForUpdates) return false;
  if (!s.lastUpdateCheck) return true;
  const at = Date.parse(s.lastUpdateCheck);
  if (Number.isNaN(at) || at > now) return true;
  return now - at >= CHECK_INTERVAL_MS;
}

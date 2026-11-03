export const PREVIEW_PORTS = { min: 18000, max: 19999 } as const;
export const ALLOW_LIVE_ENV = "E2E_ALLOW_LIVE";

const PREVIEW_HOSTS = new Set(["localhost", "127.0.0.1"]);
const EXAMPLE_ORIGIN = "http://localhost:18300";
const EXAMPLE = `APP_ORIGIN=${EXAMPLE_ORIGIN}`;

const redact = (value: string) => value.replace(/^([a-z][a-z\d+.-]*:\/\/)[^/?#]*@/i, "$1***@");

function parse(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

export function previewOriginProblem(raw: string | undefined, name = "APP_ORIGIN"): string | undefined {
  const value = raw?.trim() ?? "";
  if (!value) return `${name} is not set; e2e runs need it explicitly, e.g. ${name}=${EXAMPLE_ORIGIN}`;
  const rule = `${name} must be http://localhost or http://127.0.0.1 on a port in ${PREVIEW_PORTS.min}-${PREVIEW_PORTS.max}`;
  const url = parse(value);
  if (!url) return `${rule}; got an invalid URL`;
  const port = Number(url.port);
  const ok =
    url.protocol === "http:" &&
    PREVIEW_HOSTS.has(url.hostname) &&
    port >= PREVIEW_PORTS.min &&
    port <= PREVIEW_PORTS.max &&
    value === url.origin;
  return ok ? undefined : `${rule}; got ${redact(value)}`;
}

export function liveOriginProblem(raw: string | undefined): string | undefined {
  const value = raw?.trim() ?? "";
  if (!value) return `APP_ORIGIN is not set; e2e runs need it explicitly, e.g. ${EXAMPLE}`;
  const url = parse(value);
  const ok = url !== undefined && (url.protocol === "http:" || url.protocol === "https:") && value === url.origin;
  return ok ? undefined : `APP_ORIGIN must be an http(s) origin with no path or trailing slash; got ${redact(value)}`;
}

export const allowLive = (env: Readonly<Record<string, string | undefined>>): boolean => env[ALLOW_LIVE_ENV] === "1";

export function appOrigin(input: { explicit: string | undefined; allowLive: boolean }): string {
  const origin = input.explicit?.trim() ?? "";
  if (input.allowLive) {
    const problem = liveOriginProblem(origin);
    if (problem) throw new Error(`refusing to run e2e: ${problem}`);
    return origin;
  }
  const problem = previewOriginProblem(origin);
  if (!problem) return origin;
  const optIn = origin ? `; to target any other origin on purpose, also set ${ALLOW_LIVE_ENV}=1 in the command's environment` : "";
  throw new Error(`refusing to run e2e: ${problem}${optIn}`);
}

export const PREVIEW_PROJECTS = ["smoke", "preview-m1"] as const;
export const PREVIEW_PORTS = { min: 18000, max: 19999 } as const;

const PREVIEW_HOSTS = new Set(["localhost", "127.0.0.1"]);

const pattern = (name: string) =>
  new RegExp(`^${name.toLocaleLowerCase().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`);

function requestedProjects(argv: readonly string[]): string[] | undefined {
  const names: string[] = [];
  let seen = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--project=")) {
      seen = true;
      names.push(arg.slice("--project=".length));
    } else if (arg === "--project") {
      seen = true;
      while (i + 1 < argv.length && !argv[i + 1].startsWith("-")) names.push(argv[++i]);
    }
  }
  return seen ? names : undefined;
}

export function runsPreviewProject(argv: readonly string[]): boolean {
  const names = requestedProjects(argv);
  if (!names) return true;
  return names.some((name) => PREVIEW_PROJECTS.some((project) => pattern(name).test(project)));
}

export function previewOriginProblem(raw: string | undefined): string | undefined {
  const value = raw?.trim() ?? "";
  if (!value) return "APP_ORIGIN is not set; preview runs need it explicitly, e.g. APP_ORIGIN=http://localhost:18300";
  const rule = `APP_ORIGIN must be http://localhost or http://127.0.0.1 on a port in ${PREVIEW_PORTS.min}-${PREVIEW_PORTS.max}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `${rule}; got an invalid URL`;
  }
  const port = Number(url.port);
  const ok =
    url.protocol === "http:" &&
    PREVIEW_HOSTS.has(url.hostname) &&
    port >= PREVIEW_PORTS.min &&
    port <= PREVIEW_PORTS.max &&
    value === url.origin;
  return ok ? undefined : `${rule}; got ${value}`;
}

export function appOrigin(input: {
  argv: readonly string[];
  explicit: string | undefined;
  fallback: string;
  inWorker: boolean;
}): string {
  const explicit = input.explicit?.trim() ?? "";
  if (!input.inWorker && runsPreviewProject(input.argv)) {
    const problem = previewOriginProblem(explicit);
    if (problem) throw new Error(`refusing to run the preview projects (${PREVIEW_PROJECTS.join(", ")}): ${problem}`);
    return explicit;
  }
  const origin = explicit || input.fallback.trim();
  if (!origin) throw new Error("missing APP_ORIGIN (deploy-config/env-files/.env-e2e)");
  return origin;
}

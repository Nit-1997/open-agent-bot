export type ApiClient = Readonly<{
  url(path: `/${string}`): string;
  fetch(path: `/${string}`, init?: RequestInit): Promise<Response>;
}>;

const DEFAULT_BASE = "/api";

function guard(path: string): string {
  if (path.startsWith("//") || path.includes("\\")) throw new TypeError(`Refusing an API path that could leave the origin: ${path}`);
  return path;
}

export function createApiClient(opts: { baseUrl: string; fetch?: typeof fetch }): ApiClient {
  const url = (path: `/${string}`) => `${opts.baseUrl}${guard(path)}`;
  return Object.freeze({
    url,
    fetch(path: `/${string}`, init?: RequestInit) {
      const target = url(path);
      const send = opts.fetch ?? globalThis.fetch;
      return init === undefined ? send(target) : send(target, init);
    },
  });
}

let current: ApiClient = createApiClient({ baseUrl: DEFAULT_BASE });
let configuredBase: string | null = null;

const baseOf = (client: ApiClient) => client.url("/").slice(0, -1);

export function configureApi(client: ApiClient): void {
  const base = baseOf(client);
  if (configuredBase !== null && configuredBase !== base)
    throw new Error(`The API client is already configured for "${configuredBase}"; refusing "${base}".`);
  configuredBase = base;
  current = client;
}

export function api(): ApiClient {
  return current;
}

export function resetApiForTests(): void {
  current = createApiClient({ baseUrl: DEFAULT_BASE });
  configuredBase = null;
}

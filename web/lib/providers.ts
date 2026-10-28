export type ProviderView = {
  id: string;
  label: string;
  kind: "cloud" | "local";
  site: string;
  keyUrl?: string;
  defaultBaseUrl?: string;
  methods: Array<"api_key" | "oauth">;
  oauthLabel?: string;
  configured: boolean;
  source?: "key" | "signin" | "server";
  baseUrl?: string;
  enabled: string[];
  modelCount: number;
};

export type ProviderModel = { id: string; label: string; contextWindow: number; note?: string; enabled: boolean };
export type TestResult = { ok: boolean; toolCall: boolean; latencyMs: number; cost?: number; error?: string };

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/providers${path}`, { ...init, headers: { "content-type": "application/json" } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export const providersApi = {
  list: () => call<{ providers: ProviderView[] }>("").then((r) => r.providers),
  saveKey: (id: string, apiKey: string) => call(`/${id}/key`, { method: "POST", body: JSON.stringify({ apiKey }) }),
  remove: (id: string) => call(`/${id}`, { method: "DELETE" }),
  addLocal: (input: { kind: string; baseUrl: string; apiKey?: string; label?: string }) =>
    call<{ provider: ProviderView }>("/local", { method: "POST", body: JSON.stringify(input) }).then((r) => r.provider),
  models: (id: string) => call<{ models: ProviderModel[] }>(`/${id}/models`).then((r) => r.models),
  setEnabled: (id: string, enabled: string[]) => call(`/${id}/models`, { method: "PUT", body: JSON.stringify({ enabled }) }),
  test: (model: string) => call<TestResult>("/test", { method: "POST", body: JSON.stringify({ model }) }),
};

export function contextLabel(tokens: number): string {
  return tokens >= 1_000_000 ? `${Math.round(tokens / 100_000) / 10}M ctx` : `${Math.round(tokens / 1000)}K ctx`;
}

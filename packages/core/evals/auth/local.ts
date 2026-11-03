import type { Transport } from "../types.js";

const RUN_PATH = "/api/copilotkit/agent/openagent/run";
const KEY_PATH = "/api/providers/openrouter/key";

function originOf(raw: string): string {
  let url: URL | undefined;
  try {
    url = new URL(raw);
  } catch {}
  if (!url || !/^https?:$/.test(url.protocol) || url.origin !== raw) {
    throw new Error(
      `--origin must be an http(s) origin with no path, e.g. http://127.0.0.1:18330; got '${raw.replace(/\/\/[^/@]*@/, "//***@")}'`,
    );
  }
  return url.origin;
}

async function errorCode(res: Response): Promise<string> {
  try {
    const error = ((await res.json()) as { error?: unknown }).error;
    return typeof error === "string" ? ` ${error}` : "";
  } catch {
    return "";
  }
}

export async function localTransport(opts: { origin: string; openrouterKey?: string; fetch?: typeof fetch }): Promise<Transport> {
  const origin = originOf(opts.origin);
  const doFetch = opts.fetch ?? fetch;
  if (opts.openrouterKey !== undefined) {
    const res = await doFetch(`${origin}${KEY_PATH}`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ apiKey: opts.openrouterKey }),
    });
    if (!res.ok) throw new Error(`couldn't save the OpenRouter key: HTTP ${res.status}${await errorCode(res)}`);
  }
  return { url: `${origin}${RUN_PATH}`, headers: async () => ({ origin }) };
}

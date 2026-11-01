import type { AuthContext } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

const ALLOWED = new Set(["LLM_API_KEY"]);

function recordingContext(names: Set<string>): AuthContext {
  return {
    async env(name) {
      names.add(name);
      return undefined;
    },
    async fileExists() {
      return false;
    },
  };
}

export async function providerEnvNames(): Promise<string[]> {
  const names = new Set<string>();
  const ctx = recordingContext(names);
  const signal = new AbortController().signal;
  for (const provider of builtinProviders()) {
    await provider.auth.apiKey?.resolve({ ctx, signal }).catch(() => undefined);
  }
  return [...names].filter((n) => !ALLOWED.has(n)).sort();
}

export async function ambientProviderEnv(env: NodeJS.ProcessEnv): Promise<string[]> {
  return (await providerEnvNames()).filter((name) => !!env[name]?.trim());
}

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../../src/config.js";
import { createPiSession } from "../../src/pi/createPiSession.js";
import { ProviderHub } from "../../src/providers/hub.js";

export async function liveSession(systemPrompt: string, tools: ToolDefinition<any, any, any>[]) {
  const cfg = loadConfig(process.env);
  const hub = await ProviderHub.create({
    dataDir: mkdtempSync(join(tmpdir(), "live-")),
    litellm: { baseUrl: cfg.llmBaseUrl, apiKey: cfg.llmApiKey ?? "none", models: cfg.models },
  });
  const model = hub.resolve(cfg.model);
  if (!model) throw new Error(`model ${cfg.model} is not available`);
  return createPiSession({ runtime: hub.runtime, model, systemPrompt, tools });
}

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createPiSession } from "../../src/pi/createPiSession.js";
import { testHub } from "../fixtures/hub.js";

export async function liveSession(systemPrompt: string, tools: ToolDefinition<any, any, any>[]) {
  const baseUrl = process.env.LLM_BASE_URL ?? "http://localhost:4000/v1";
  const modelId = process.env.LIVE_MODEL ?? "chat-default";
  const hub = await testHub({
    litellm: { baseUrl, apiKey: process.env.LLM_API_KEY ?? "none", models: [{ id: modelId, label: modelId }] },
    fetch,
  });
  const model = hub.resolve(`litellm/${modelId}`);
  if (!model) throw new Error(`model ${modelId} is not available`);
  return createPiSession({ runtime: hub.runtime, model, systemPrompt, tools });
}

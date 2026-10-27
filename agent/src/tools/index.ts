import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ArtifactStore } from "../artifacts/store.js";
import type { AgentConfig } from "../config.js";
import { createArtifactTool } from "./createArtifact.js";
import { showWidgetTool } from "./showWidget.js";

export type ToolDeps = { cfg: AgentConfig; artifacts: ArtifactStore };

export function buildTools(deps: ToolDeps): ToolDefinition<any, any, any>[] {
  return [showWidgetTool(), createArtifactTool(deps.artifacts)];
}

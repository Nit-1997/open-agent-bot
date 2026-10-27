import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ArtifactStore } from "../artifacts/store.js";
import type { AgentConfig } from "../config.js";
import { createArtifactTool } from "./createArtifact.js";
import { fetchPageTool } from "./fetchPage.js";
import { showWidgetTool } from "./showWidget.js";
import { weatherTool } from "./weather.js";
import { webSearchTool } from "./webSearch.js";

export type ToolDeps = { cfg: AgentConfig; artifacts: ArtifactStore };

export function buildTools(deps: ToolDeps): ToolDefinition<any, any, any>[] {
  return [
    webSearchTool({ searxngUrl: deps.cfg.searxngUrl }),
    fetchPageTool(),
    weatherTool(),
    showWidgetTool(),
    createArtifactTool(deps.artifacts),
  ];
}

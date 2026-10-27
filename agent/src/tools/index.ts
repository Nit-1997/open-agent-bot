import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ArtifactStore } from "../artifacts/store.js";
import type { AgentConfig } from "../config.js";
import type { UserContext } from "../prompt/systemPrompt.js";
import { browseTool } from "./browse.js";
import type { BrowserPool } from "./browserPool.js";
import { createArtifactTool } from "./createArtifact.js";
import { fetchPageTool } from "./fetchPage.js";
import { flightsTool } from "./flights.js";
import type { ToolResult } from "./result.js";
import { showFlightsTool, showPlanTool, showProductsTool } from "./showWidget.js";
import { weatherTool } from "./weather.js";
import { webSearchTool } from "./webSearch.js";

export type ToolDeps = {
  cfg: AgentConfig;
  artifacts: ArtifactStore;
  pool: BrowserPool;
  threadId: string;
  userContext: UserContext | null;
};

export function buildTools(deps: ToolDeps): ToolDefinition<any, any, any>[] {
  const browse = browseTool({ pool: deps.pool, threadId: deps.threadId, userContext: deps.userContext });
  return [
    webSearchTool({ searxngUrl: deps.cfg.searxngUrl }),
    fetchPageTool(),
    browse,
    weatherTool(),
    flightsTool({
      locale: deps.userContext?.locale ?? "en-US",
      browse: (actions) => browse.execute("flights", { actions } as never, undefined, undefined, {} as never) as Promise<ToolResult>,
    }),
    showProductsTool(),
    showFlightsTool(),
    showPlanTool(),
    createArtifactTool(deps.artifacts),
  ];
}

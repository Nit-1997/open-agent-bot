import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ArtifactStore } from "../artifacts/store.js";
import type { AgentConfig } from "../config.js";
import { regionFor } from "../prompt/region.js";
import type { UserContext } from "../prompt/systemPrompt.js";
import { browseTool } from "./browse.js";
import { ToolBudget, withBudget } from "./budget.js";
import type { BrowserPool } from "./browserPool.js";
import { createArtifactTool } from "./createArtifact.js";
import { fetchPageTool } from "./fetchPage.js";
import { flightsTool } from "./flights.js";
import { geocode, type LatLon } from "./geo.js";
import type { ToolResult } from "./result.js";
import { askUserTool } from "./askUser.js";
import { showUiTool } from "./showWidget.js";
import { weatherTool } from "./weather.js";
import { webSearchTool } from "./webSearch.js";

export type ToolDeps = {
  cfg: AgentConfig;
  artifacts: ArtifactStore;
  pool: BrowserPool;
  threadId: string;
  userContext: UserContext | null;
  budget: ToolBudget;
};

export const PER_REPLY_LIMITS = { search: 4, read: 4, flights: 2 };

function memo<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined;
  return () => (p ??= fn());
}

export function buildTools(deps: ToolDeps): ToolDefinition<any, any, any>[] {
  const homeText = deps.userContext?.profile?.home;
  const home = homeText ? memo<LatLon | null>(() => geocode(homeText)) : undefined;
  const browse = browseTool({ pool: deps.pool, threadId: deps.threadId, userContext: deps.userContext });
  return [
    withBudget(webSearchTool({ searxngUrl: deps.cfg.searxngUrl }), deps.budget, "search"),
    withBudget(fetchPageTool(), deps.budget, "read"),
    withBudget(browse, deps.budget, "read"),
    weatherTool({ defaultUnits: regionFor(deps.userContext).country === "US" ? "imperial" : "metric" }),
    withBudget(flightsTool({
      locale: deps.userContext?.locale ?? "en-US",
      currency: regionFor(deps.userContext).currency,
      browse: (actions) => browse.execute("flights", { actions } as never, undefined, undefined, {} as never) as Promise<ToolResult>,
      home,
    }), deps.budget, "flights"),
    showUiTool(),
    askUserTool(),
    createArtifactTool(deps.artifacts),
  ];
}

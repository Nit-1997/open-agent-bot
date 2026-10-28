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
import { AIRPORTS, type Drive, driveRoute, geocode, type LatLon } from "./geo.js";
import type { ToolResult } from "./result.js";
import type { Evidence } from "../grounding/evidence.js";
import { askUserTool } from "./askUser.js";
import { showUiTool, suggestRepliesTool } from "./showWidget.js";
import { weatherTool } from "./weather.js";
import { imageSearchTool, matchingImage, search as runSearch, webSearchTool } from "./webSearch.js";
import { musicTool, wikipediaTool } from "./lookup.js";

export type ToolDeps = {
  cfg: AgentConfig;
  artifacts: ArtifactStore;
  pool: BrowserPool;
  threadId: string;
  userContext: UserContext | null;
  budget: ToolBudget;
  evidence?: Evidence;
};

export const PER_REPLY_LIMITS = { search: 4, images: 4, lookup: 4, read: 4, flights: 2 };

function memo<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined;
  return () => (p ??= fn());
}

export function buildTools(deps: ToolDeps): ToolDefinition<any, any, any>[] {
  const homeText = deps.userContext?.profile?.home;
  const home = homeText ? memo<LatLon | null>(() => geocode(homeText)) : undefined;
  const drives = new Map<string, Promise<Drive | null>>();
  const drive = home
    ? (code: string) => {
        if (!drives.has(code)) {
          drives.set(
            code,
            home().then((h) => (h && AIRPORTS[code] ? driveRoute(h, AIRPORTS[code]) : null)),
          );
        }
        return drives.get(code)!;
      }
    : undefined;
  const search = { searxngUrl: deps.cfg.searxngUrl, braveApiKey: deps.cfg.braveApiKey };
  const browse = browseTool({ pool: deps.pool, threadId: deps.threadId, userContext: deps.userContext });
  return [
    withBudget(webSearchTool(search), deps.budget, "search"),
    withBudget(imageSearchTool(search), deps.budget, "images"),
    withBudget(musicTool({ country: regionFor(deps.userContext).country }), deps.budget, "lookup"),
    withBudget(wikipediaTool(), deps.budget, "lookup"),
    withBudget(fetchPageTool(), deps.budget, "read"),
    withBudget(browse, deps.budget, "read"),
    weatherTool({ defaultUnits: regionFor(deps.userContext).country === "US" ? "imperial" : "metric" }),
    withBudget(flightsTool({
      locale: deps.userContext?.locale ?? "en-US",
      currency: regionFor(deps.userContext).currency,
      browse: (actions) => browse.execute("flights", { actions } as never, undefined, undefined, {} as never) as Promise<ToolResult>,
      drive,
    }), deps.budget, "flights"),
    showUiTool({ isSourced: (u) => deps.evidence?.hasUrl(u) ?? true, findImage: async (name, source) => matchingImage(name, await runSearch(search, [name, source].filter(Boolean).join(" "), "images", 10)) }),
    suggestRepliesTool(),
    askUserTool(),
    createArtifactTool(deps.artifacts),
  ];
}

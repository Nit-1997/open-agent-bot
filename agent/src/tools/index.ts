import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ArtifactStore } from "../artifacts/store.js";
import type { AgentConfig } from "../config.js";
import { regionFor } from "../prompt/region.js";
import type { UserContext } from "../prompt/userContext.js";
import { browseTool, runBrowse } from "./browse.js";
import { type Budget, withBudget } from "./budget.js";
import type { BrowserPool } from "../browser/pool.js";
import { imageLoads } from "../artifacts/images.js";
import { createArtifactTool } from "./createArtifact.js";
import { fetchPageTool } from "./fetchPage.js";
import { flightsTool } from "./flights.js";
import { AIRPORTS, type Drive, driveRoute, geocode, type LatLon, nearbyAirports } from "./geo.js";
import type { Evidence } from "../grounding/evidence.js";
import { type FrameBus, watch } from "../browser/frames.js";
import type { OpenTab } from "../stays/types.js";
import type { ActiveCart } from "../shop/cart.js";
import { type Judge, noJudge } from "../judge/index.js";
import { askUserTool, FIELDS_HELP } from "./askUser.js";
import { REPORT_GUIDE } from "../artifacts/reportKit.js";
import { musicCover } from "./musicArt.js";
import { BLOCKS_HELP, showUiTool } from "./showWidget.js";
import { weatherTool } from "./weather.js";
import { imageSearchTool, matchingImage, search as runSearch, webSearchTool } from "./webSearch.js";
import { musicTool, wikipediaTool } from "./lookup.js";
import { shopTool } from "./shop.js";
import { staysTool } from "./stays.js";
import { loadSkillTool } from "./loadSkill.js";
import { RULES, shopRules, withRules } from "./rules.js";
import type { SkillEntry } from "../skills/catalog.js";
import type { WorkspaceStore } from "../workspace/store.js";
import { planTool } from "./plan.js";
import { researchTool } from "./research.js";
import type { Complete } from "../workflows/llm.js";

type ToolDeps = {
  cfg: AgentConfig;
  artifacts: ArtifactStore;
  pool: BrowserPool;
  threadId: string;
  userContext: UserContext | null;
  budget: Budget;
  evidence?: Evidence;
  frames?: FrameBus;
  cart?: ActiveCart;
  skills?: SkillEntry[];
  judge?: Judge;
  workspace?: WorkspaceStore;
  complete?: Complete;
};

export const PER_REPLY_LIMITS = { search: 4, images: 4, lookup: 4, read: 6, flights: 2, shop: 2, stays: 2, research: 2 };

const CODEMODE_TOOLS: ReadonlySet<string> = new Set([
  "web_search",
  "fetch_page",
  "wikipedia",
  "music",
  "weather",
  "shop",
  "stays",
  "flights",
]);

export function scopeToCodemode(tools: ToolDefinition<any, any, any>[]): ToolDefinition<any, any, any>[] {
  return tools.map((t) => (CODEMODE_TOOLS.has(t.name) ? t : { ...t, exposure: "model-only" as const }));
}

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
  const nearby = home
    ? async () => {
        const h = await home();
        return h ? nearbyAirports(h) : [];
      }
    : undefined;
  const judge = deps.judge ?? noJudge;
  const country = regionFor(deps.userContext).country;
  const search = { searxngUrl: deps.cfg.searxngUrl, braveApiKey: deps.cfg.braveApiKey };
  const openTab: OpenTab = async (live) => {
    const page = await deps.pool.tab(deps.threadId, deps.userContext);
    const stop = live && deps.frames ? await watch(page, deps.frames).catch(() => undefined) : undefined;
    return {
      page,
      close: async () => {
        await stop?.();
        await page.close().catch(() => {});
      },
    };
  };
  const browseDeps = { pool: deps.pool, threadId: deps.threadId, userContext: deps.userContext, frames: deps.frames };
  const tools: ToolDefinition<any, any, any>[] = [
    withBudget(webSearchTool(search), deps.budget, "search"),
    withBudget(withRules(imageSearchTool(search), RULES.imageSearch), deps.budget, "images"),
    withBudget(musicTool({ country, judge }), deps.budget, "lookup"),
    withBudget(wikipediaTool(), deps.budget, "lookup"),
    withBudget(fetchPageTool(), deps.budget, "read"),
    withBudget(browseTool(browseDeps), deps.budget, "read"),
    withBudget(
      withRules(
        shopTool({
          pool: deps.pool,
          threadId: deps.threadId,
          userContext: deps.userContext,
          frames: deps.frames,
          cart: deps.cart,
          judge,
          region: country,
          webSearch: (query) => runSearch(search, query, "web", 8),
        }),
        shopRules(country),
      ),
      deps.budget,
      "shop",
    ),
    withRules(weatherTool({ defaultUnits: country === "US" ? "imperial" : "metric" }), RULES.weather),
    withBudget(
      withRules(
        flightsTool({
          locale: deps.userContext?.locale ?? "en-US",
          currency: regionFor(deps.userContext).currency,
          browse: (actions, opts) => runBrowse(browseDeps, actions, opts),
          drive,
          nearby,
        }),
        RULES.flights,
      ),
      deps.budget,
      "flights",
    ),
    withBudget(
      withRules(staysTool({ openTab, region: country, currency: regionFor(deps.userContext).currency, judge }), RULES.stays),
      deps.budget,
      "stays",
    ),
    withRules(
      showUiTool({
        findMusicArt: musicCover({ country, judge }),
        isSourced: (u) => deps.evidence?.hasUrl(u) ?? true,
        findImage: async (name, source) =>
          matchingImage(name, await runSearch(search, [name, source].filter(Boolean).join(" "), "images", 10)),
      }),
      RULES.showUi,
      BLOCKS_HELP,
    ),
    withRules(askUserTool(), RULES.askUser, FIELDS_HELP),
    withRules(
      createArtifactTool(deps.artifacts, { isSourced: (u) => deps.evidence?.hasUrl(u) ?? false, loads: imageLoads() }),
      RULES.createArtifact,
      REPORT_GUIDE,
    ),
    ...(deps.complete
      ? [
          withBudget(
            researchTool({
              search,
              artifacts: deps.artifacts,
              images: { isSourced: (u) => deps.evidence?.hasUrl(u) ?? false, loads: imageLoads() },
              complete: deps.complete,
              judge,
              evidence: deps.evidence,
            }),
            deps.budget,
            "research",
          ),
        ]
      : []),
    loadSkillTool(() => deps.skills ?? []),
    ...(deps.workspace ? [planTool({ store: deps.workspace, threadId: deps.threadId })] : []),
  ];
  return scopeToCodemode(tools);
}

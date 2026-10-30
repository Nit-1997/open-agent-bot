import type { Page } from "playwright";
import { BOT_WALL, isBlockedUrl } from "../tools/browsePolicy.js";
import { publicHttpUrlError } from "../tools/net.js";
import type { Stay, StayQuery, StaySource } from "./types.js";

const MAX_PER_SOURCE = 10;

export type SourceResult = {
  source: StaySource;
  url: string;
  status: "ok" | "blocked" | "failed" | "link";
  stays: Stay[];
  error?: string;
};

export type OpenTab = (live: boolean) => Promise<{ page: Page; close: () => Promise<void> }>;

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(600);
  }
}

export async function searchSource(
  source: StaySource,
  q: StayQuery,
  openTab: OpenTab,
  live: boolean,
  opts: { allowPrivateHosts?: boolean } = {},
): Promise<SourceResult> {
  const url = source.searchUrl(q);
  if (!source.read) return { source, url, status: "link", stays: [] };
  const urlError = publicHttpUrlError(url, opts);
  if (urlError) return { source, url, status: "failed", stays: [], error: urlError };
  const tab = await openTab(live);
  try {
    const res = await tab.page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    if (isBlockedUrl(tab.page.url())) return { source, url, status: "blocked", stays: [] };
    await settle(tab.page);
    const head = await tab.page.evaluate(() => `${document.title}\n${document.body?.innerText.slice(0, 1500) ?? ""}`);
    if ((res && res.status() === 429) || BOT_WALL.test(head)) return { source, url, status: "blocked", stays: [] };
    const stays = (await source.read(tab.page, q)).slice(0, MAX_PER_SOURCE);
    return { source, url, status: stays.length ? "ok" : "failed", stays, ...(!stays.length && { error: "no listings could be read" }) };
  } catch (err) {
    return { source, url, status: "failed", stays: [], error: err instanceof Error ? err.message.split("\n")[0] : String(err) };
  } finally {
    await tab.close();
  }
}

export async function searchStays(
  sources: StaySource[],
  q: StayQuery,
  openTab: OpenTab,
  opts: { allowPrivateHosts?: boolean } = {},
): Promise<SourceResult[]> {
  let firstLive = true;
  return Promise.all(
    sources.map((s) => {
      const live = !!s.read && firstLive;
      if (live) firstLive = false;
      return searchSource(s, q, openTab, live, opts);
    }),
  );
}

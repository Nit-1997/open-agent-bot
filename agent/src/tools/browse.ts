import { defineTool } from "@earendil-works/pi-coding-agent";
import type { Locator, Page } from "playwright";
import { Type } from "typebox";
import type { UserContext } from "../prompt/userContext.js";
import { type FrameBus, watch } from "../browser/frames.js";
import type { BrowserPool } from "../browser/pool.js";
import { BOT_WALL, type BrowseAction, checkAction, isBlockedUrl, type TargetInfo } from "../browser/policy.js";
import { fail, ok, type ToolResult } from "./result.js";
import { BLOCKING_STATUSES, publicHttpUrlError } from "../lib/net.js";
import { htmlToText, imagesText, truncate } from "./text.js";

const MAX_ACTIONS = 10;

const ActionSchema = Type.Union([
  Type.Object({ op: Type.Literal("goto"), url: Type.String() }),
  Type.Object({ op: Type.Literal("click"), selector: Type.Optional(Type.String()), text: Type.Optional(Type.String()) }),
  Type.Object({ op: Type.Literal("type"), selector: Type.String(), value: Type.String(), submit: Type.Optional(Type.Boolean()) }),
  Type.Object({ op: Type.Literal("select"), selector: Type.String(), value: Type.String() }),
  Type.Object({ op: Type.Literal("wait"), ms: Type.Number() }),
  Type.Object({ op: Type.Literal("read") }),
]);

function locate(page: Page, a: BrowseAction): Locator | undefined {
  if (a.op === "click") {
    if (a.selector) return page.locator(a.selector).first();
    if (a.text) return page.getByText(a.text, { exact: false }).first();
  }
  if (a.op === "type" || a.op === "select") return page.locator(a.selector).first();
  return undefined;
}

async function targetInfo(loc: Locator): Promise<TargetInfo> {
  return loc.evaluate((el) => ({
    type: el.getAttribute("type") ?? undefined,
    name: el.getAttribute("name") ?? el.getAttribute("aria-label") ?? el.getAttribute("placeholder") ?? undefined,
    autocomplete: el.getAttribute("autocomplete") ?? undefined,
    text: ((el as HTMLElement).innerText || (el as HTMLInputElement).value || "").slice(0, 200),
  }));
}

const handoff = (reason: string, url: string) => ok(`stopped: ${reason}. Hand this link to the user: ${url}`, { stopped: true, url });

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
}

type BrowseDeps = { pool: BrowserPool; threadId: string; userContext: UserContext | null; allowPrivateHosts?: boolean; frames?: FrameBus };

async function perform(page: Page, a: BrowseAction, loc: Locator | undefined): Promise<number | undefined> {
  switch (a.op) {
    case "goto":
      return (await page.goto(a.url, { waitUntil: "domcontentloaded", timeout: 20000 }))?.status();
    case "click":
      await loc!.click({ timeout: 10000 });
      await settle(page);
      return undefined;
    case "type":
      await loc!.fill(a.value, { timeout: 10000 });
      if (a.submit) {
        await loc!.press("Enter");
        await settle(page);
      }
      return undefined;
    case "select":
      await loc!.selectOption(a.value, { timeout: 10000 });
      await settle(page);
      return undefined;
    case "wait":
      await page.waitForTimeout(Math.min(Math.max(a.ms, 0), 5000));
      return undefined;
    case "read":
      return undefined;
  }
}

async function leaveIfForbidden(page: Page, allowPrivateHosts: boolean | undefined): Promise<ToolResult | undefined> {
  const landedError = publicHttpUrlError(page.url(), { allowPrivateHosts });
  if (landedError && page.url() !== "about:blank") {
    await page.goto("about:blank").catch(() => {});
    return fail(`stopped: ${landedError}`);
  }
  if (isBlockedUrl(page.url())) {
    const url = page.url();
    await page.goBack().catch(() => {});
    return handoff("reached a login, cart, checkout, or payment page", url);
  }
  return undefined;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

async function readPage(page: Page, lastStatus: number | undefined): Promise<ToolResult> {
  const url = page.url();
  const html = await page.content();
  const body = htmlToText(html);
  if ((lastStatus && BLOCKING_STATUSES.has(lastStatus)) || (BOT_WALL.test(body.slice(0, 2000)) && body.length < 3000)) {
    return ok(`blocked by ${hostOf(url)}: ${url}`, { blocked: true, url });
  }
  const shown = truncate(body);
  return ok(`url: ${url}\ntitle: ${await page.title()}\n\n${shown}${imagesText(html, url, shown)}`, { url });
}

export async function runBrowse(
  deps: BrowseDeps,
  actions: BrowseAction[],
  opts: { fresh?: boolean; live?: boolean } = {},
): Promise<ToolResult> {
  if (actions.length > MAX_ACTIONS) return fail(`too many actions (max ${MAX_ACTIONS} per call)`);
  const page = opts.fresh ? await deps.pool.tab(deps.threadId, deps.userContext) : await deps.pool.page(deps.threadId, deps.userContext);
  const stopWatch = deps.frames && opts.live !== false ? await watch(page, deps.frames).catch(() => undefined) : undefined;
  let lastStatus: number | undefined;

  try {
    for (const a of actions) {
      const loc = locate(page, a);
      const target = loc ? await targetInfo(loc) : undefined;
      const verdict = checkAction(a, { url: page.url(), target }, { allowPrivateHosts: deps.allowPrivateHosts });
      if (!verdict.allowed) return handoff(verdict.reason, a.op === "goto" ? a.url : page.url());

      lastStatus = (await perform(page, a, loc)) ?? lastStatus;
      const stopped = await leaveIfForbidden(page, deps.allowPrivateHosts);
      if (stopped) return stopped;
    }
    return await readPage(page, lastStatus);
  } catch (err) {
    return fail(`browse failed on ${page.url()}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
  } finally {
    await stopWatch?.();
    if (opts.fresh) await page.close().catch(() => {});
  }
}

export function browseTool(deps: BrowseDeps) {
  return defineTool({
    name: "browse",
    label: "Browse",
    description:
      "Control a real browser as a guest to read pages that need JavaScript or interaction. Actions run in order on this chat's tab and the tab persists between calls: goto a URL, click (by CSS selector or visible text), type into a field (submit:true presses Enter), select an option, wait (ms ≤ 5000), read. Returns the final page text. Allowed: searching, filtering, entering a PIN/ZIP code, choosing dates or stores. It refuses checkout, cart, payment, login, sign-up, and booking steps and returns the link for the user instead.",
    parameters: Type.Object({ actions: Type.Array(ActionSchema, { minItems: 1 }) }),
    execute: (_id, params) => runBrowse(deps, params.actions as BrowseAction[]),
  });
}

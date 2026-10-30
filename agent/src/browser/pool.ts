import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import type { UserContext } from "../prompt/userContext.js";
import { blockInternalRequests } from "./guard.js";

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 430, height: 932 };

export function browseViewport(ctx: UserContext | null): { width: number; height: number } {
  return ctx?.viewport && ctx.viewport.width < 640 ? PHONE : DESKTOP;
}

export class BrowserPool {
  private browser?: Promise<Browser>;
  private threads = new Map<string, Promise<{ context: BrowserContext; page: Page }>>();

  constructor(private readonly opts: { allowPrivateHosts?: boolean } = {}) {}

  private launch(): Promise<Browser> {
    if (!this.browser) {
      const launching = chromium.launch({ args: ["--disable-dev-shm-usage"] });
      launching.catch(() => {
        if (this.browser === launching) this.browser = undefined;
      });
      this.browser = launching;
    }
    return this.browser;
  }

  page(threadId: string, ctx: UserContext | null): Promise<Page> {
    let t = this.threads.get(threadId);
    if (!t) {
      t = (async () => {
        const context = await (await this.launch()).newContext({
          userAgent: USER_AGENT,
          locale: ctx?.locale,
          timezoneId: ctx?.timeZone,
          viewport: DESKTOP,
        });
        context.setDefaultTimeout(20000);
        await blockInternalRequests(context, this.opts);
        const page = await context.newPage();
        await page.setViewportSize(browseViewport(ctx));
        return { context, page };
      })();
      t.catch(() => this.threads.delete(threadId));
      this.threads.set(threadId, t);
    }
    return t.then(async (x) => {
      if (x.page.isClosed()) {
        x.page = await x.context.newPage();
        await x.page.setViewportSize(browseViewport(ctx));
      }
      return x.page;
    });
  }

  async tab(threadId: string, ctx: UserContext | null): Promise<Page> {
    await this.page(threadId, ctx);
    const { context } = await this.threads.get(threadId)!;
    return context.newPage();
  }

  async close(threadId: string): Promise<void> {
    const t = this.threads.get(threadId);
    this.threads.delete(threadId);
    if (t) await (await t).context.close().catch(() => {});
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.threads.keys()].map((id) => this.close(id)));
    const browser = this.browser;
    this.browser = undefined;
    if (browser) await (await browser).close().catch(() => {});
  }
}

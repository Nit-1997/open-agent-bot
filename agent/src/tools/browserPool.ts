import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import type { UserContext } from "../prompt/systemPrompt.js";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export class BrowserPool {
  private browser?: Promise<Browser>;
  private threads = new Map<string, Promise<{ context: BrowserContext; page: Page }>>();

  private launch(): Promise<Browser> {
    this.browser ??= chromium.launch({ args: ["--disable-dev-shm-usage"] });
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
          viewport: { width: 1280, height: 900 },
        });
        context.setDefaultTimeout(20000);
        const page = await context.newPage();
        return { context, page };
      })();
      t.catch(() => this.threads.delete(threadId));
      this.threads.set(threadId, t);
    }
    return t.then(async (x) => (x.page.isClosed() ? await x.context.newPage() : x.page));
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
    if (this.browser) await (await this.browser).close();
    this.browser = undefined;
  }
}

import { type Browser, type BrowserContextOptions, chromium, type Page } from "playwright";
import { stripForRender } from "./sanitize.js";

export const THUMB_VIEWPORT = { width: 800, height: 320 };
export const THUMB_SCALE = 1.5;
export const RENDER_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"] as const;
export const LAUNCH_ARGS = [`--host-resolver-rules=MAP * ~NOTFOUND, ${RENDER_HOSTS.map((h) => `EXCLUDE ${h}`).join(", ")}`];
const ALLOWED_URL = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
const LOAD_MS = 20_000;
const FONTS_MS = 3_000;
const DEADLINE_MS = 25_000;

export type ChromiumRendererOptions = { deadlineMs?: number; sandbox?: boolean };

export async function settleFonts(page: Pick<Page, "evaluate">, ms = FONTS_MS): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => {}),
    new Promise<void>((r) => {
      timer = setTimeout(r, ms);
    }),
  ]);
  clearTimeout(timer);
}

export class ChromiumRenderer {
  private browser?: Promise<Browser>;

  constructor(private readonly opts: ChromiumRendererOptions = {}) {}

  pdf(html: string): Promise<Buffer> {
    return this.run({}, html, (page) => page.pdf({ format: "A4", printBackground: true }));
  }

  thumb(html: string): Promise<Buffer> {
    return this.run({ javaScriptEnabled: false, viewport: THUMB_VIEWPORT, deviceScaleFactor: THUMB_SCALE }, html, async (page) => {
      await settleFonts(page);
      return page.screenshot({ type: "jpeg", quality: 70, clip: { x: 0, y: 0, ...THUMB_VIEWPORT } });
    });
  }

  private async run(options: BrowserContextOptions, html: string, take: (page: Page) => Promise<Buffer>): Promise<Buffer> {
    const context = await (await this.launch()).newContext(options);
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("render timed out")), this.opts.deadlineMs ?? DEADLINE_MS);
    });
    const work = (async () => {
      await context.route("**/*", (route) => (ALLOWED_URL.test(route.request().url()) ? route.fallback() : route.abort("blockedbyclient")));
      const page = await context.newPage();
      await page.setContent(stripForRender(html), { waitUntil: "load", timeout: LOAD_MS });
      return await take(page);
    })();
    work.catch(() => {});
    try {
      return await Promise.race([work, deadline]);
    } finally {
      clearTimeout(timer);
      await context.close().catch(() => {});
    }
  }

  private launch(): Promise<Browser> {
    if (!this.browser) {
      const launching = chromium.launch({ args: LAUNCH_ARGS, chromiumSandbox: this.opts.sandbox ?? false });
      launching.catch(() => {
        if (this.browser === launching) this.browser = undefined;
      });
      this.browser = launching;
    }
    return this.browser;
  }

  async close(): Promise<void> {
    const browser = this.browser;
    this.browser = undefined;
    if (browser) await (await browser).close().catch(() => {});
  }
}

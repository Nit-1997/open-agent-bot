import { randomBytes } from "node:crypto";
import { type Browser, type BrowserContext, chromium } from "playwright";
import { ARTIFACT_ID_RE } from "../../../shared/artifacts.js";
import { blockInternalRequests } from "../browser/guard.js";
import type { UserRepos } from "../db/types.js";
import { createLimiter, type Limiter } from "../lib/concurrency.js";
import { UserError } from "../lib/errors.js";
import { log } from "../lib/log.js";

const RENDER_SLOTS = 2;
export const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
export const THUMB_VIEWPORT = { width: 800, height: 320 };
export const THUMB_SCALE = 1.5;
const THUMB_LOAD_MS = 20_000;
const THUMB_FONTS_MS = 3_000;
const THUMB_DEADLINE_MS = 25_000;
const FONT_URL = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

export type ArtifactOwner = Pick<UserRepos, "userId" | "artifacts" | "storage">;
export type ArtifactSink = { save(title: string, html: string): Promise<{ id: string }> };
export type Renderer = (html: string) => Promise<Buffer>;
export type RenderOpts = { beforeRender?: () => void };

export class ArtifactStore {
  private browser?: Promise<Browser>;
  private readonly rendering = new Map<string, Promise<Buffer | null>>();
  private readonly renderSlot = createLimiter(RENDER_SLOTS);
  private readonly userSlots = new Map<string, { run: Limiter; pending: number }>();

  constructor(
    private readonly render: Renderer = (html) => this.renderWithChromium(html),
    private readonly renderThumb: Renderer = (html) => this.thumbWithChromium(html),
  ) {}

  sink(owner: ArtifactOwner, chatId: string | null): ArtifactSink {
    return { save: (title, html) => this.save(owner, chatId, title, html) };
  }

  async save(owner: ArtifactOwner, chatId: string | null, title: string, html: string): Promise<{ id: string }> {
    const bytes = Buffer.from(html, "utf8");
    if (bytes.length > MAX_ARTIFACT_BYTES) throw new UserError("That report is too large (5 MB at most).", "too_large");
    const id = randomBytes(9).toString("base64url");
    await owner.storage.upload(id, "html", bytes);
    try {
      await owner.artifacts.insert({ id, chatId, title, sizeBytes: bytes.length });
    } catch (err) {
      await owner.storage.remove(id, "html").catch(() => log.warn(`[artifacts] orphaned object user=${owner.userId} id=${id}`));
      throw err;
    }
    this.thumbnail(owner, id).catch((err) => log.warn(`[artifacts] thumbnail failed user=${owner.userId} id=${id}`, err));
    return { id };
  }

  async get(owner: ArtifactOwner, id: string): Promise<{ title: string; html: string } | null> {
    if (!ARTIFACT_ID_RE.test(id)) return null;
    const meta = await owner.artifacts.get(id);
    if (!meta) return null;
    const html = await owner.storage.download(id, "html");
    return html ? { title: meta.title, html: html.toString("utf8") } : null;
  }

  async renderPdf(owner: ArtifactOwner, id: string, opts: RenderOpts = {}): Promise<{ title: string; pdf: Buffer } | null> {
    if (!ARTIFACT_ID_RE.test(id)) return null;
    const meta = await owner.artifacts.get(id);
    if (!meta) return null;
    if (meta.pdfReady) {
      const cached = await owner.storage.download(id, "pdf");
      if (cached) return { title: meta.title, pdf: cached };
    }
    const key = `${owner.userId}:${id}:pdf`;
    let pending = this.rendering.get(key);
    if (!pending) {
      opts.beforeRender?.();
      pending = (async () => {
        const html = await owner.storage.download(id, "html");
        if (!html) throw new UserError("That report doesn't exist.", "not_found");
        const pdf = await this.slot(owner.userId, () => this.render(html.toString("utf8")));
        await owner.storage.upload(id, "pdf", pdf);
        await owner.artifacts.setPdf(id);
        return pdf;
      })().finally(() => this.rendering.delete(key));
      this.rendering.set(key, pending);
    }
    const pdf = await pending;
    return pdf ? { title: meta.title, pdf } : null;
  }

  thumbnail(owner: ArtifactOwner, id: string, opts: RenderOpts = {}): Promise<Buffer | null> {
    if (!ARTIFACT_ID_RE.test(id)) return Promise.resolve(null);
    const key = `${owner.userId}:${id}:jpg`;
    const inflight = this.rendering.get(key);
    if (inflight) return inflight;
    const pending = (async () => {
      const meta = await owner.artifacts.get(id);
      if (!meta) return null;
      if (meta.thumbReady) {
        const cached = await owner.storage.download(id, "jpg");
        if (cached) return cached;
      }
      opts.beforeRender?.();
      const html = await owner.storage.download(id, "html");
      if (!html) return null;
      const jpg = await this.slot(owner.userId, () => this.renderThumb(html.toString("utf8")));
      await owner.storage.upload(id, "jpg", jpg);
      if (!(await owner.artifacts.setThumb(id))) {
        await owner.storage.remove(id, "jpg").catch(() => log.warn(`[artifacts] orphaned thumbnail user=${owner.userId} id=${id}`));
        return null;
      }
      return jpg;
    })().finally(() => this.rendering.delete(key));
    this.rendering.set(key, pending);
    return pending;
  }

  private slot<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    let entry = this.userSlots.get(userId);
    if (!entry) {
      entry = { run: createLimiter(1), pending: 0 };
      this.userSlots.set(userId, entry);
    }
    const mine = entry;
    mine.pending++;
    return mine
      .run(() => this.renderSlot(fn))
      .finally(() => {
        if (--mine.pending === 0 && this.userSlots.get(userId) === mine) this.userSlots.delete(userId);
      });
  }

  private async renderWithChromium(html: string): Promise<Buffer> {
    const context = await (await this.launch()).newContext();
    await blockInternalRequests(context);
    try {
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: "load", timeout: 20000 });
      return await page.pdf({ format: "A4", printBackground: true });
    } finally {
      await context.close();
    }
  }

  private async thumbWithChromium(html: string): Promise<Buffer> {
    const context = await (await this.launch()).newContext({
      javaScriptEnabled: false,
      viewport: THUMB_VIEWPORT,
      deviceScaleFactor: THUMB_SCALE,
    });
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("thumbnail render timed out")), THUMB_DEADLINE_MS);
    });
    try {
      return await Promise.race([this.shoot(context, html), deadline]);
    } finally {
      clearTimeout(timer);
      await context.close().catch(() => {});
    }
  }

  private async shoot(context: BrowserContext, html: string): Promise<Buffer> {
    await blockInternalRequests(context);
    await context.route("**/*", (route) => (FONT_URL.test(route.request().url()) ? route.fallback() : route.abort("blockedbyclient")));
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: THUMB_LOAD_MS });
    await Promise.race([
      page.evaluate(() => document.fonts.ready.then(() => undefined)),
      new Promise((r) => setTimeout(r, THUMB_FONTS_MS)),
    ]);
    return await page.screenshot({ type: "jpeg", quality: 70, clip: { x: 0, y: 0, ...THUMB_VIEWPORT } });
  }

  private launch(): Promise<Browser> {
    if (!this.browser) {
      const launching = chromium.launch();
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

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "artifact"
  );
}

import { randomBytes } from "node:crypto";
import { type Browser, chromium } from "playwright";
import { ARTIFACT_ID_RE } from "../../../shared/artifacts.js";
import { blockInternalRequests } from "../browser/guard.js";
import type { UserRepos } from "../db/types.js";
import { createLimiter } from "../lib/concurrency.js";
import { UserError } from "../lib/errors.js";
import { log } from "../lib/log.js";

const PDF_RENDERS = 2;
export const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;

export type ArtifactOwner = Pick<UserRepos, "userId" | "artifacts" | "storage">;
export type ArtifactSink = { save(title: string, html: string): Promise<{ id: string }> };

export class ArtifactStore {
  private browser?: Promise<Browser>;
  private readonly rendering = new Map<string, Promise<Buffer>>();
  private readonly renderSlot = createLimiter(PDF_RENDERS);

  constructor(private readonly render: (html: string) => Promise<Buffer> = (html) => this.renderWithChromium(html)) {}

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
    return { id };
  }

  async get(owner: ArtifactOwner, id: string): Promise<{ title: string; html: string } | null> {
    if (!ARTIFACT_ID_RE.test(id)) return null;
    const meta = await owner.artifacts.get(id);
    if (!meta) return null;
    const html = await owner.storage.download(id, "html");
    return html ? { title: meta.title, html: html.toString("utf8") } : null;
  }

  async renderPdf(owner: ArtifactOwner, id: string): Promise<{ title: string; pdf: Buffer } | null> {
    if (!ARTIFACT_ID_RE.test(id)) return null;
    const meta = await owner.artifacts.get(id);
    if (!meta) return null;
    if (meta.pdfReady) {
      const cached = await owner.storage.download(id, "pdf");
      if (cached) return { title: meta.title, pdf: cached };
    }
    const key = `${owner.userId}:${id}`;
    let pending = this.rendering.get(key);
    if (!pending) {
      pending = (async () => {
        const html = await owner.storage.download(id, "html");
        if (!html) throw new UserError("That report doesn't exist.", "not_found");
        const pdf = await this.renderSlot(() => this.render(html.toString("utf8")));
        await owner.storage.upload(id, "pdf", pdf);
        await owner.artifacts.setPdf(id);
        return pdf;
      })().finally(() => this.rendering.delete(key));
      this.rendering.set(key, pending);
    }
    return { title: meta.title, pdf: await pending };
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

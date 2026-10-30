import { randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Browser, chromium } from "playwright";
import { ARTIFACT_ID_RE } from "../../../shared/artifacts.js";
import { blockInternalRequests } from "../browser/guard.js";
import { createLimiter } from "../lib/concurrency.js";
import { writeFileAtomic } from "../lib/files.js";

const PDF_RENDERS = 2;

export class ArtifactStore {
  private browser?: Promise<Browser>;
  private readonly rendering = new Map<string, Promise<Buffer>>();
  private readonly renderSlot = createLimiter(PDF_RENDERS);

  constructor(private readonly dir: string) {}

  async save(title: string, html: string): Promise<{ id: string }> {
    await mkdir(this.dir, { recursive: true });
    const id = randomBytes(9).toString("base64url");
    await writeFileAtomic(join(this.dir, `${id}.html`), html, 0o644);
    await writeFileAtomic(join(this.dir, `${id}.json`), JSON.stringify({ title, createdAt: new Date().toISOString() }), 0o644);
    return { id };
  }

  async get(id: string): Promise<{ title: string; html: string } | null> {
    if (!ARTIFACT_ID_RE.test(id)) return null;
    try {
      const [html, meta] = await Promise.all([
        readFile(join(this.dir, `${id}.html`), "utf8"),
        readFile(join(this.dir, `${id}.json`), "utf8"),
      ]);
      return { title: JSON.parse(meta).title, html };
    } catch {
      return null;
    }
  }

  async renderPdf(id: string): Promise<Buffer | null> {
    const a = await this.get(id);
    if (!a) return null;
    const file = join(this.dir, `${id}.pdf`);
    const cached = await readFile(file).catch(() => null);
    if (cached) return cached;
    let pending = this.rendering.get(id);
    if (!pending) {
      pending = this.renderSlot(() => this.render(a.html))
        .then(async (pdf) => {
          await writeFileAtomic(file, pdf, 0o644);
          return pdf;
        })
        .finally(() => this.rendering.delete(id));
      this.rendering.set(id, pending);
    }
    return pending;
  }

  private async render(html: string): Promise<Buffer> {
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

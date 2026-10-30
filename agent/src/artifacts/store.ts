import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Browser, chromium } from "playwright";
import { ARTIFACT_ID_RE } from "../../../shared/artifacts.js";
import { blockInternalRequests } from "../tools/browserGuard.js";

export class ArtifactStore {
  private browser?: Promise<Browser>;

  constructor(private readonly dir: string) {}

  async save(title: string, html: string): Promise<{ id: string }> {
    await mkdir(this.dir, { recursive: true });
    const id = randomBytes(9).toString("base64url");
    await writeFile(join(this.dir, `${id}.html`), html, "utf8");
    await writeFile(join(this.dir, `${id}.json`), JSON.stringify({ title, createdAt: new Date().toISOString() }), "utf8");
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
    const context = await (await this.launch()).newContext();
    await blockInternalRequests(context);
    try {
      const page = await context.newPage();
      await page.setContent(a.html, { waitUntil: "load", timeout: 20000 });
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

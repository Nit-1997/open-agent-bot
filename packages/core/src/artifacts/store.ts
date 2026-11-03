import { randomBytes } from "node:crypto";
import { ARTIFACT_ID_RE } from "@oab/shared/artifacts";
import type { UserRepos } from "../store/types.js";
import { createLimiter, type Limiter } from "../lib/concurrency.js";
import { UserError } from "../lib/errors.js";
import { log } from "../lib/log.js";

const RENDER_SLOTS = 2;
export const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
const THUMB_DEADLINE_MS = 30_000;
const PDF_DEADLINE_MS = 35_000;
const FAILURE_TTL_MS = 10 * 60_000;
const MAX_FAILURES = 5000;

export type ArtifactOwner = Pick<UserRepos, "userId" | "artifacts" | "storage">;
export type ArtifactSink = { save(title: string, html: string): Promise<{ id: string }> };
export type Renderer = (html: string, signal: AbortSignal) => Promise<Buffer>;
export type RenderOpts = { beforeRender?: () => void };
export type ArtifactStoreOptions = { thumbDeadlineMs?: number; pdfDeadlineMs?: number; now?: () => number };

const noPreview = () => new UserError("This report has no preview right now.", "unavailable", { code: "no_preview" });

export class ArtifactStore {
  private readonly rendering = new Map<string, Promise<Buffer | null>>();
  private readonly renderSlot = createLimiter(RENDER_SLOTS);
  private readonly userSlots = new Map<string, { run: Limiter; pending: number }>();
  private readonly thumbFailures = new Map<string, number>();
  private readonly now: () => number;

  constructor(
    private readonly render: Renderer,
    private readonly renderThumb: Renderer,
    private readonly opts: ArtifactStoreOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
  }

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
    this.thumbnail(owner, id).catch((err) => {
      if (!(err instanceof UserError)) log.warn(`[artifacts] thumbnail failed user=${owner.userId} id=${id}`, err);
    });
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
        const pdf = await this.slot(owner.userId, () => this.deadline(this.render, html, this.opts.pdfDeadlineMs ?? PDF_DEADLINE_MS)).catch(
          (err) => {
            log.warn(`[artifacts] pdf render failed user=${owner.userId} id=${id}`, err);
            throw new UserError("The PDF couldn't be made right now. Try again in a minute.", "unavailable", { code: "render_failed" });
          },
        );
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
    const failedAt = this.thumbFailures.get(`${owner.userId}:${id}`);
    if (failedAt !== undefined && this.now() - failedAt < FAILURE_TTL_MS) return Promise.reject(noPreview());
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
      const jpg = await this.slot(owner.userId, () =>
        this.deadline(this.renderThumb, html, this.opts.thumbDeadlineMs ?? THUMB_DEADLINE_MS),
      ).catch((err) => {
        this.failed(`${owner.userId}:${id}`);
        log.warn(`[artifacts] thumbnail render failed user=${owner.userId} id=${id}`, err);
        throw noPreview();
      });
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

  private async deadline(render: Renderer, html: Buffer, ms: number): Promise<Buffer> {
    const abort = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new Error(`render timed out after ${ms} ms`));
      }, ms);
    });
    try {
      return await Promise.race([render(html.toString("utf8"), abort.signal), expired]);
    } finally {
      clearTimeout(timer);
    }
  }

  private failed(key: string): void {
    const now = this.now();
    for (const [k, at] of this.thumbFailures)
      if (now - at >= FAILURE_TTL_MS || this.thumbFailures.size >= MAX_FAILURES) this.thumbFailures.delete(k);
    this.thumbFailures.set(key, now);
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

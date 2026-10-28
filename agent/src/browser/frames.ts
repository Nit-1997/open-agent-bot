import type { Page } from "playwright";

export type Frame = { url: string; data: string };

export class FrameBus {
  private subs = new Set<(f: Frame) => void>();
  private last = Number.NEGATIVE_INFINITY;
  private pending?: Frame;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly intervalMs = 500) {}

  get size(): number {
    return this.subs.size;
  }

  subscribe(cb: (f: Frame) => void): () => void {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  }

  publish(f: Frame): void {
    const wait = this.last + this.intervalMs - Date.now();
    if (wait <= 0) {
      this.send(f);
      return;
    }
    this.pending = f;
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      if (this.pending) this.send(this.pending);
    }, wait);
  }

  private send(f: Frame): void {
    this.pending = undefined;
    this.last = Date.now();
    for (const s of this.subs) s(f);
  }
}

export async function watch(page: Page, bus: FrameBus): Promise<() => Promise<void>> {
  const cdp = await page.context().newCDPSession(page);
  let live = true;
  cdp.on("Page.screencastFrame", (e) => {
    cdp.send("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => {});
    if (live) bus.publish({ url: page.url(), data: e.data });
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: 800, maxHeight: 600 });
  return async () => {
    live = false;
    await cdp.send("Page.stopScreencast").catch(() => {});
    await cdp.detach().catch(() => {});
  };
}

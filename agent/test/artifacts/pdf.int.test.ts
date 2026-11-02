import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { MemoryDb } from "../fixtures/memoryRepos.js";
import { ALICE } from "../fixtures/users.js";

const stores: ArtifactStore[] = [];
afterEach(async () => {
  await Promise.all(stores.splice(0).map((s) => s.close()));
});

describe("ArtifactStore PDF rendering in Chromium", () => {
  it("renders a real PDF and closes the browser afterwards", async () => {
    const store = new ArtifactStore();
    stores.push(store);
    const alice = new MemoryDb().forUser(ALICE.id);
    const { id } = await store.save(alice, null, "Trip", "<h1>Lisbon</h1>");
    const out = await store.renderPdf(alice, id);
    expect(out?.pdf.subarray(0, 4).toString()).toBe("%PDF");
    await store.close();
    expect((store as unknown as { browser?: unknown }).browser).toBeUndefined();
  }, 60000);

  it("renders a 1200x480 JPEG with scripts off and no outside requests", async () => {
    const store = new ArtifactStore();
    stores.push(store);
    const alice = new MemoryDb().forUser(ALICE.id);
    const requests: string[] = [];
    const outside = createServer((req, res) => {
      requests.push(req.url ?? "");
      res.writeHead(200, { "content-type": "image/png" }).end();
    });
    await new Promise<void>((r) => outside.listen(0, "127.0.0.1", r));
    try {
      const port = (outside.address() as AddressInfo).port;
      const html = `<!doctype html><html><body style="margin:0;background:#fff">
<h1 id="h" style="color:#000">Static heading</h1>
<img src="http://127.0.0.1:${port}/pixel.png">
<img src="https://example.com/pixel.png">
<script>document.body.style.background = "#ff0000"; document.getElementById("h").textContent = "changed";</script>
</body></html>`;
      const { id } = await store.save(alice, null, "Thumb", html);
      const jpg = await store.thumbnail(alice, id);
      expect(jpg?.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
      const { width, height } = jpegSize(jpg!);
      expect([width, height]).toEqual([1200, 480]);
      expect(requests).toEqual([]);
      const page = await (await chromium.launch()).newPage();
      try {
        await page.setContent(`<canvas id="c" width="1200" height="480"></canvas>`);
        const [r, g, b] = await page.evaluate(async (b64) => {
          const img = new Image();
          img.src = `data:image/jpeg;base64,${b64}`;
          await img.decode();
          const ctx = (document.getElementById("c") as HTMLCanvasElement).getContext("2d")!;
          ctx.drawImage(img, 0, 0);
          return Array.from(ctx.getImageData(1100, 400, 1, 1).data);
        }, jpg!.toString("base64"));
        expect(r).toBeGreaterThan(240);
        expect(g).toBeGreaterThan(240);
        expect(b).toBeGreaterThan(240);
      } finally {
        await page.context().browser()?.close();
      }
    } finally {
      await new Promise((r) => outside.close(r));
    }
  }, 60000);
});

function jpegSize(buf: Buffer): { width: number; height: number } {
  let i = 2;
  while (i < buf.length) {
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error("no SOF marker");
}

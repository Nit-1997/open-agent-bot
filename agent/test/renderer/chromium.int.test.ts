import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ChromiumRenderer, settleFonts } from "../../src/renderer/chromium.js";

const renderers: ChromiumRenderer[] = [];
const make = (opts?: ConstructorParameters<typeof ChromiumRenderer>[0]) => {
  const r = new ChromiumRenderer(opts);
  renderers.push(r);
  return r;
};
afterEach(async () => {
  await Promise.all(renderers.splice(0).map((r) => r.close()));
});

let server: Server;
let port = 0;
const hits: string[] = [];
let connections = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(`${req.headers.host}${req.url}`);
    res.writeHead(200, { "content-type": "text/plain" }).end("x");
  });
  server.on("connection", () => connections++);
  await new Promise<void>((r) => server.listen(0, r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});

const HOSTS = ["127.0.0.1", "localhost", "[::1]", "127.1", "2130706433"];

function vectors(host: string): string {
  const u = (n: string) => `http://${host}:${port}/${n}`;
  return `<link rel="stylesheet" href="${u("link")}"><link rel="preload" href="${u("preload")}" as="image">
<link rel="prefetch" href="${u("prefetch")}"><link rel="prerender" href="${u("prerender")}"><link rel="preconnect" href="${u("")}">
<link rel="dns-prefetch" href="${u("")}"><link rel="modulepreload" href="${u("modpre")}"><link rel="icon" href="${u("icon")}">
<link rel="manifest" href="${u("manifest")}">
<script type="speculationrules">{"prefetch":[{"source":"list","urls":["${u("specrule")}"]}],"prerender":[{"source":"list","urls":["${u("specprerender")}"]}]}</script>
<style>@import url(${u("import")});@font-face{font-family:x;src:url(${u("font")})} .bg{font-family:x;background:url(${u("bg")})} .set{background-image:image-set("${u("imageset")}" 1x)}</style>
<div class="bg set">bg</div><img src="${u("img")}"><img srcset="${u("srcset")} 1x"><picture><source srcset="${u("source")}"><img alt=""></picture>
<object data="${u("obj")}"></object><embed src="${u("embed")}"><iframe src="${u("iframe")}"></iframe><iframe srcdoc="<img src='${u("srcdoc")}'>"></iframe>
<video poster="${u("poster")}" src="${u("video")}"><track src="${u("track")}"></video><audio src="${u("audio")}"></audio>
<svg><image href="${u("svgimg")}"/></svg><input type="image" src="${u("input")}"><a ping="${u("ping")}" href="#">a</a>
<form action="${u("form")}"></form><script src="${u("script")}"></script>
<script>
fetch("${u("fetch")}").catch(() => {});
new Image().src = "${u("jsimg")}";
navigator.sendBeacon("${u("beacon")}", "x");
try { new WebSocket("ws://${host}:${port}/ws"); } catch {}
try { new EventSource("${u("sse")}"); } catch {}
const hint = document.createElement("link"); hint.rel = "prefetch"; hint.href = "${u("dynprefetch")}"; document.head.append(hint);
const rules = document.createElement("script"); rules.type = "speculationrules";
rules.textContent = JSON.stringify({ prefetch: [{ source: "list", urls: ["${u("dynspec")}"] }] }); document.head.append(rules);
</script>`;
}

const page = (body: string, head = "") => `<!doctype html><html><head>${head}</head><body>${body}<p>hi</p></body></html>`;

describe("ChromiumRenderer", () => {
  it("renders a real PDF", async () => {
    const pdf = await make().pdf("<h1>Lisbon</h1>");
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  }, 60000);

  it("renders a 1200x480 JPEG with scripts off", async () => {
    const jpg = await make().thumb(`<!doctype html><html><body style="margin:0;background:#fff">
<h1 id="h" style="color:#000">Static heading</h1>
<script>document.body.style.background = "#ff0000";</script>
</body></html>`);
    expect(jpg.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
    expect(jpegSize(jpg)).toEqual({ width: 1200, height: 480 });
    const [r, g, b] = await pixel(jpg, 1100, 400);
    expect(r).toBeGreaterThan(240);
    expect(g).toBeGreaterThan(240);
    expect(b).toBeGreaterThan(240);
  }, 60000);

  for (const kind of ["pdf", "thumb"] as const) {
    it(`makes no request to an internal host while rendering a ${kind}`, async () => {
      hits.length = 0;
      connections = 0;
      const r = make();
      for (const host of HOSTS) {
        const head = `<meta http-equiv="refresh" content="1;url=http://${host}:${port}/refresh">`;
        const out = await r[kind](page(vectors(host), head));
        expect(out.length).toBeGreaterThan(0);
      }
      await new Promise((res) => setTimeout(res, 2500));
      expect(hits).toEqual([]);
      expect(connections).toBe(0);
    }, 120000);
  }

  it("takes the thumbnail of a page with a meta refresh", async () => {
    const jpg = await make().thumb(`<meta http-equiv="refresh" content="0;url=http://127.0.0.1:${port}/refresh"><h1>stay</h1>`);
    expect(jpg.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
  }, 60000);

  it("waits for fonts but carries on when the page's context is destroyed", async () => {
    const gone = { evaluate: () => Promise.reject(new Error("page.evaluate: Execution context was destroyed")) };
    await expect(settleFonts(gone as never, 5000)).resolves.toBeUndefined();
    const stuck = { evaluate: () => new Promise(() => {}) };
    const started = Date.now();
    await settleFonts(stuck as never, 50);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("gives up on a render that never finishes and keeps working afterwards", async () => {
    const r = make({ deadlineMs: 1500 });
    const started = Date.now();
    await expect(r.pdf("<script>for(;;){}</script>")).rejects.toThrow(/timed out/);
    expect(Date.now() - started).toBeLessThan(10000);
    expect((await r.pdf("<p>after</p>")).subarray(0, 4).toString()).toBe("%PDF");
  }, 60000);

  it("closes the browser", async () => {
    const r = make();
    await r.pdf("<p>x</p>");
    await r.close();
    expect((r as unknown as { browser?: unknown }).browser).toBeUndefined();
  }, 60000);
});

async function pixel(jpg: Buffer, x: number, y: number): Promise<number[]> {
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage();
    await p.setContent(`<canvas id="c" width="1200" height="480"></canvas>`);
    return await p.evaluate(
      async ([b64, px, py]) => {
        const img = new Image();
        img.src = `data:image/jpeg;base64,${b64}`;
        await img.decode();
        const ctx = (document.getElementById("c") as HTMLCanvasElement).getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        return Array.from(ctx.getImageData(px as number, py as number, 1, 1).data);
      },
      [jpg.toString("base64"), x, y] as const,
    );
  } finally {
    await browser.close();
  }
}

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

import { afterAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { FrameBus, watch } from "../../src/browser/frames.js";

const browserP = chromium.launch();
afterAll(async () => (await browserP).close());

describe("watch (real Chromium)", () => {
  it("streams JPEG frames of the page with its url until stopped", async () => {
    const page = await (await browserP).newPage();
    await page.route("https://live.test/**", (r) => r.fulfill({ contentType: "text/html", body: "<h1 style='font-size:80px'>Hello</h1>" }));
    await page.goto("https://live.test/a");
    const bus = new FrameBus(0);
    const frames: Array<{ url: string; data: string }> = [];
    bus.subscribe((f) => frames.push(f));
    const stop = await watch(page, bus);
    await page.evaluate(() => (document.body.style.background = "red"));
    for (let i = 0; i < 20 && !frames.length; i++) await page.waitForTimeout(100);
    await stop();
    const n = frames.length;
    await page.evaluate(() => (document.body.style.background = "blue"));
    await page.waitForTimeout(300);
    expect(n).toBeGreaterThan(0);
    expect(frames.length).toBe(n);
    expect(frames[0].url).toBe("https://live.test/a");
    expect(Buffer.from(frames[0].data, "base64").subarray(0, 2).toString("hex")).toBe("ffd8");
  });
});

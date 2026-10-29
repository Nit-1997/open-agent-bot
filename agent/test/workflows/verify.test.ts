import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createJudge, type Judge, noJudge } from "../../src/judge/index.js";
import { verifyReport } from "../../src/workflows/verify.js";
import { nullJudge, numberJudge, REPORT, SOURCE_A, SOURCE_B } from "./fixtures.js";

const sources = [SOURCE_A, SOURCE_B];

describe("verifyReport", () => {
  it("drops the planted false sentence and keeps the supported ones beside it", async () => {
    const r = await verifyReport(REPORT, sources, numberJudge());
    expect(r.html).not.toContain("COP of 5.0");
    expect(r.html).toContain("A typical install costs $14,500 before incentives");
    expect(r.html).not.toContain('class="unverified"');
    expect(r.claims.filter((c) => c.verdict === "unsupported").map((c) => c.text)).toEqual([expect.stringContaining("COP of 5.0")]);
    expect(r).toMatchObject({ removed: 1, flagged: 0, unchecked: 0 });
    expect(r.supported).toBe(r.total - 1);
  });

  it("flags rather than drops a false claim that stands alone in its cell, paragraph or list", async () => {
    const src = { url: "https://s.example.org/a", text: "The unit costs $100 and lasts 15 years." };
    const html = `<p>It lasts 40 years <a href="${src.url}">[1]</a>.</p><ul><li>Costs $900 <a href="${src.url}">[1]</a>.</li></ul><table><tr><td>Price</td><td>$900 <a href="${src.url}">[1]</a></td></tr></table><div class="stat">$900</div>`;
    const r = await verifyReport(html, [src], numberJudge());
    expect(r).toMatchObject({ removed: 0, flagged: 4 });
    expect(r.html.match(/class="unverified"/g)).toHaveLength(4);
  });

  it("drops a false list item when the list keeps others", async () => {
    const src = { url: "https://s.example.org/a", text: "The unit costs $100 and lasts 15 years." };
    const html = `<ul><li>Costs $100 <a href="${src.url}">[1]</a>.</li><li>Lasts 40 years <a href="${src.url}">[1]</a>.</li></ul><ol><li>Lasts 15 years <a href="${src.url}">[1]</a>.</li></ol>`;
    const r = await verifyReport(html, [src], numberJudge());
    expect(r.html).toBe(`<ul><li>Costs $100 <a href="${src.url}">[1]</a>.</li></ul><ol><li>Lasts 15 years <a href="${src.url}">[1]</a>.</li></ol>`);
    expect(r).toMatchObject({ removed: 1, flagged: 0 });
  });

  it("checks table cells with their row label and normalizes cited urls", async () => {
    const r = await verifyReport(REPORT, sources, numberJudge());
    expect(r.claims).toContainEqual({ text: "Furnace install: $6,200 [2]", url: SOURCE_B.url, verdict: "supported" });
    expect(r.claims.find((c) => c.text.includes("96%"))?.url).toBe(SOURCE_B.url);
  });

  it("leaves the sources list alone", async () => {
    const r = await verifyReport(REPORT, sources, numberJudge());
    expect(r.claims.some((c) => c.text === "Energy")).toBe(false);
    expect(r.html).toContain('<li><a href="https://energy.example.org/heat-pumps">Energy</a></li>');
  });

  it("marks claims not checked when the judge is down, never verified", async () => {
    for (const judge of [nullJudge, noJudge]) {
      const r = await verifyReport(REPORT, sources, judge);
      expect(r.supported).toBe(0);
      expect(r.unchecked).toBe(r.total);
      expect(r.total).toBeGreaterThan(3);
      expect(r.html).toContain('class="unchecked"');
      expect(r.html).not.toContain('class="unverified"');
    }
  });

  it("sends one batch per source with the source text shared", async () => {
    const seen: unknown[] = [];
    const judge: Judge = {
      ...numberJudge(),
      yesno: async (items, _c, o) => {
        seen.push({ n: items.length, source: o?.batch?.shared.source ?? items[0].state.source });
        return items.map((i) => ({ id: i.id, yes: true, p: 1 }));
      },
    };
    await verifyReport(REPORT, sources, judge);
    expect(seen).toHaveLength(2);
    expect(seen).toContainEqual({ n: 2, source: SOURCE_A.text });
  });
});

describe.skipIf(!process.env.OPENROUTER_API_KEY)("verify with live Jev", () => {
  it("flags the planted COP claim and passes the true ones", { timeout: 120000 }, async () => {
    const runtime = await ModelRuntime.create({ authPath: join(mkdtempSync(join(tmpdir(), "verify-")), "auth.json"), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
    const judge = await createJudge({ runtime, model: process.env.JEV_MODEL ?? "openrouter/typesafe/jev-1.14", log: () => {}, timeoutMs: 20000 });
    expect(judge.available).toBe(true);
    const r = await verifyReport(REPORT, sources, judge);
    console.log(`[verify] ${JSON.stringify(r.claims)} cost $${judge.usage().costUsd.toFixed(5)} calls ${judge.usage().calls}`);
    expect(r.unchecked).toBe(0);
    expect(r.claims.find((c) => c.text.includes("COP of 5.0"))?.verdict).toBe("unsupported");
    for (const part of ["$14,500", "96%", "$6,200"]) expect(r.claims.find((c) => c.text.includes(part))?.verdict).toBe("supported");
  });
});

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, type Page } from "@playwright/test";

const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

type AxeResult = { violations: Array<{ id: string; nodes: Array<{ target: string[]; failureSummary?: string }> }> };

export async function expectContrast(page: Page, label: string): Promise<void> {
  await page.addScriptTag({ content: AXE });
  const result = await page.evaluate(
    async () =>
      (await (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<unknown> } }).axe.run(document, {
        runOnly: { type: "rule", values: ["color-contrast"] },
      })) as unknown,
  );
  const violations = (result as AxeResult).violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary ?? ""}`));
  expect(violations, `color-contrast on ${label}`).toEqual([]);
}

export async function expectNoHorizontalScroll(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `horizontal scroll on ${label}`).toBeLessThanOrEqual(0);
}

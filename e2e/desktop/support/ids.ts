import { expect, type Page } from "@playwright/test";

export async function everyElementHasUniqueId(page: Page): Promise<void> {
  const report = await page.evaluate(() => {
    const all = [...document.querySelectorAll("*")];
    const missing = [...document.querySelectorAll("body *:not([id])")].map((e) => e.outerHTML.slice(0, 80));
    const seen = new Map<string, number>();
    for (const e of all) if (e.id) seen.set(e.id, (seen.get(e.id) ?? 0) + 1);
    const duplicated = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
    const headMissing = [...document.querySelectorAll("html, head, head *, body")].filter((e) => !e.id).map((e) => e.tagName.toLowerCase());
    return { missing, duplicated, headMissing };
  });
  expect(report).toEqual({ missing: [], duplicated: [], headMissing: [] });
}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(import.meta.dirname, "../../src/styles/theme.css"), "utf8");

type Rgb = [number, number, number];

function block(selector: string): Record<string, string> {
  const at = CSS.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`theme.css has no ${selector} block`);
  const body = CSS.slice(at, CSS.indexOf("}", at));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const hex = (h: string): Rgb => {
  const m = /^#([0-9a-f]{6})$/i.exec(h);
  if (!m) throw new Error(`not a #rrggbb colour: ${h}`);
  return [0, 2, 4].map((i) => Number.parseInt(m[1].slice(i, i + 2), 16)) as Rgb;
};

function colour(value: string): Rgb {
  const mix = /^color-mix\(in srgb, (#[0-9a-f]{6}) (\d+)%, (#[0-9a-f]{6})\)$/i.exec(value);
  if (!mix) return hex(value);
  const p = Number(mix[2]) / 100;
  const a = hex(mix[1]);
  const b = hex(mix[3]);
  return a.map((c, i) => Math.round(c * p + b[i] * (1 - p))) as Rgb;
}

const luminance = (rgb: Rgb) => {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const MODES = { light: block(":root"), dark: { ...block(":root"), ...block("html.dark") } };

const PAIRS: [string, string][] = [
  ["status-danger-fg", "status-danger-bg"],
  ["status-danger-fg", "bg"],
  ["status-danger-fg", "paper"],
  ["bg", "status-danger-fg"],
  ["status-success-fg", "status-success-bg"],
  ["status-info-fg", "status-info-bg"],
  ["status-warn-fg", "status-warn-bg"],
];

describe("theme status colours meet WCAG AA for small text (4.5:1)", () => {
  it("computes the known ratio of the old light danger pair", () => {
    expect(contrast(hex("#dc2626"), hex("#fef2f2"))).toBeCloseTo(4.41, 2);
  });

  for (const [mode, vars] of Object.entries(MODES))
    for (const [fg, bg] of PAIRS)
      it(`${mode}: --${fg} on --${bg}`, () => {
        const ratio = contrast(colour(vars[fg]), colour(vars[bg]));
        expect(ratio, `${mode} --${fg} on --${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      });
});

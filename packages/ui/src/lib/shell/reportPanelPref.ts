import { DEFAULT_PANEL_FRACTION } from "./panelWidth";

const KEY = "oa.reportPanel";

export function readPanelFraction(): number {
  try {
    const raw = localStorage.getItem(KEY);
    const n = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(n) && n > 0 && n < 1 ? n : DEFAULT_PANEL_FRACTION;
  } catch {
    return DEFAULT_PANEL_FRACTION;
  }
}

export function writePanelFraction(fraction: number): void {
  try {
    localStorage.setItem(KEY, fraction.toFixed(3));
  } catch {}
}

export const SEPARATOR_PX = 12;
export const CHAT_MIN_PX = 360;
export const PANEL_MIN_PX = 380;
export const DEFAULT_PANEL_FRACTION = 0.58;
export const KEY_STEP = 0.02;
export const SHIFT_STEP = 0.1;

export type Limits = { min: number; max: number };

export function fractionLimits(available: number): Limits {
  if (!(available > 0)) return { min: 0, max: 1 };
  const min = Math.min(1, PANEL_MIN_PX / available);
  const max = Math.max(min, (available - CHAT_MIN_PX) / available);
  return { min, max };
}

export const clampFraction = (fraction: number, limits: Limits) => Math.min(limits.max, Math.max(limits.min, fraction));

export function clampPanel(fraction: number, available: number): number {
  return Math.round(clampFraction(fraction, fractionLimits(available)) * available);
}

export type SeparatorKey = "ArrowLeft" | "ArrowRight" | "Home" | "End";

export function step(fraction: number, key: SeparatorKey, shift: boolean, limits: Limits): number {
  const by = shift ? SHIFT_STEP : KEY_STEP;
  switch (key) {
    case "ArrowLeft":
      return clampFraction(fraction + by, limits);
    case "ArrowRight":
      return clampFraction(fraction - by, limits);
    case "Home":
      return limits.min;
    case "End":
      return limits.max;
  }
}

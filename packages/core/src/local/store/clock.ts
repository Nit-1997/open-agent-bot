export type Clock = () => string;

export function monotonicClock(now: () => number, seedMs: number): Clock {
  let last = Number.isFinite(seedMs) ? seedMs : 0;
  return () => {
    last = Math.max(Math.floor(now()), last + 1);
    return new Date(last).toISOString();
  };
}

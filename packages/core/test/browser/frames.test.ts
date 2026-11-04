import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Frame, FrameBus } from "../../src/browser/frames.js";

const f = (n: number): Frame => ({ url: `https://s.com/${n}`, data: `d${n}` });

describe("FrameBus", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends at most one frame per interval and always ends on the latest", () => {
    const bus = new FrameBus(500);
    const got: string[] = [];
    bus.subscribe((x) => got.push(x.data));
    bus.publish(f(1));
    bus.publish(f(2));
    bus.publish(f(3));
    expect(got).toEqual(["d1"]);
    vi.advanceTimersByTime(500);
    expect(got).toEqual(["d1", "d3"]);
    vi.advanceTimersByTime(2000);
    expect(got).toEqual(["d1", "d3"]);
  });

  it("stops sending to a subscriber after it unsubscribes", () => {
    const bus = new FrameBus(0);
    const got: string[] = [];
    const off = bus.subscribe((x) => got.push(x.data));
    bus.publish(f(1));
    off();
    bus.publish(f(2));
    expect(got).toEqual(["d1"]);
  });
});

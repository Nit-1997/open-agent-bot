import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { bindProbe, createPortPicker, PortsExhaustedError, validPort } from "../src/main/portPicker.ts";

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
});
const hold = (port: number) =>
  new Promise<void>((resolve) => {
    const s = createServer();
    servers.push(s);
    s.listen(port, "127.0.0.1", () => resolve());
  });

describe("portPicker", () => {
  it("returns the first free port in the range, skipping occupied ones", async () => {
    await hold(18491);
    const p = createPortPicker();
    expect(await p.pick([18491, 18493])).toBe(18492);
    expect(await bindProbe(18491)).toBe(false);
  });

  it("starts after a given port and wraps around", async () => {
    const free = new Set([18100, 18102]);
    const p = createPortPicker(async (n) => free.has(n));
    expect(await p.pick([18100, 18102], { after: 18100 })).toBe(18102);
    expect(await p.pick([18100, 18102], { after: 18102 })).toBe(18100);
    expect(await p.pick([18100, 18102], { after: 18100, skip: [18102] })).toBe(18100);
  });

  it("an exhausted range is an explicit error", async () => {
    const p = createPortPicker(async () => false);
    await expect(p.pick([18100, 18101])).rejects.toBeInstanceOf(PortsExhaustedError);
    await expect(p.pick([18100, 18101])).rejects.toThrow("no free port in 18100-18101");
  });

  it("valid ports are 1024–65535 integers", () => {
    expect([1023, 1024, 65535, 65536, 1.5].map(validPort)).toEqual([false, true, true, false, false]);
  });
});

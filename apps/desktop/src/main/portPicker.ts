import { createServer } from "node:net";

export interface PortPicker {
  isFree(port: number): Promise<boolean>;
  pick(range: readonly [number, number], o?: { after?: number; skip?: readonly number[] }): Promise<number>;
}

export class PortsExhaustedError extends Error {
  constructor(readonly range: readonly [number, number]) {
    super(`no free port in ${range[0]}-${range[1]}`);
    this.name = "PortsExhaustedError";
  }
}

export const validPort = (n: number) => Number.isInteger(n) && n >= 1024 && n <= 65535;

export function bindProbe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => server.close(() => resolve(true)));
  });
}

export function createPortPicker(isFree: (port: number) => Promise<boolean> = bindProbe): PortPicker {
  return {
    isFree,
    pick: async (range, o = {}) => {
      const [lo, hi] = range;
      const skip = new Set(o.skip ?? []);
      const start = o.after !== undefined && o.after >= lo && o.after < hi ? o.after + 1 : lo;
      const order = [
        ...Array.from({ length: hi - start + 1 }, (_, k) => start + k),
        ...Array.from({ length: start - lo }, (_, k) => lo + k),
      ];
      for (const p of order) if (!skip.has(p) && (await isFree(p))) return p;
      throw new PortsExhaustedError(range);
    },
  };
}

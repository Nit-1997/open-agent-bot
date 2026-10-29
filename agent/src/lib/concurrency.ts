export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function createLimiter(limit: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  const release = () => {
    active--;
    waiting.shift()?.();
  };
  return async (fn) => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

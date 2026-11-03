const PING = new TextEncoder().encode(": ping\n\n");
const LF = 10;

export type HeartbeatOptions = { intervalMs: number; maxMs?: number; onClose?: () => void };

export function withHeartbeat(source: ReadableStream<Uint8Array>, opts: HeartbeatOptions): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let closed = false;
  let tail: number[] = [];
  let beat: ReturnType<typeof setInterval> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    closed = true;
    clearInterval(beat);
    clearTimeout(deadline);
    opts.onClose?.();
  };

  const atBoundary = () => tail.length === 0 || (tail[0] === LF && tail[1] === LF);

  return new ReadableStream<Uint8Array>({
    start(controller) {
      beat = setInterval(() => {
        if (closed || !atBoundary()) return;
        try {
          controller.enqueue(PING);
        } catch {
          clearInterval(beat);
        }
      }, opts.intervalMs);
      if (opts.maxMs !== undefined) {
        deadline = setTimeout(() => {
          if (closed) return;
          stop();
          reader.cancel().catch(() => {});
          try {
            controller.close();
          } catch {}
        }, opts.maxMs);
      }
      void (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (closed) return;
            if (done) break;
            if (value.length >= 2) tail = [value[value.length - 2]!, value[value.length - 1]!];
            else if (value.length === 1) tail = [tail[1] ?? -1, value[0]!];
            controller.enqueue(value);
          }
          stop();
          controller.close();
        } catch (err) {
          if (closed) return;
          stop();
          try {
            controller.error(err);
          } catch {}
        }
      })();
    },
    cancel(reason) {
      if (closed) return;
      stop();
      return reader.cancel(reason).catch(() => {});
    },
  });
}

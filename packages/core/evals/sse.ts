export type AguiEvent = { type: string; [key: string]: unknown };

export function createSseParser() {
  let buffer = "";
  const parseBlock = (block: string): AguiEvent | null => {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) return null;
    try {
      const v = JSON.parse(data);
      return v && typeof v.type === "string" ? (v as AguiEvent) : null;
    } catch {
      return null;
    }
  };
  return {
    feed(chunk: string): AguiEvent[] {
      buffer += chunk;
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      return blocks.map(parseBlock).filter((e): e is AguiEvent => e !== null);
    },
    end(): AguiEvent[] {
      const rest = buffer;
      buffer = "";
      const e = rest.trim() ? parseBlock(rest) : null;
      return e ? [e] : [];
    },
  };
}

export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<AguiEvent> {
  const parser = createSseParser();
  const decoder = new TextDecoder();
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield* parser.feed(decoder.decode(value, { stream: true }));
    }
    yield* parser.feed(decoder.decode());
    yield* parser.end();
  } finally {
    reader.releaseLock();
  }
}

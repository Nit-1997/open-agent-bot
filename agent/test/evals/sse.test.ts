import { describe, expect, it } from "vitest";
import { createSseParser, readEvents } from "../../evals/sse.js";

const frame = (e: object) => `data: ${JSON.stringify(e)}\n\n`;

describe("createSseParser", () => {
  it("parses complete frames", () => {
    const p = createSseParser();
    expect(p.feed(frame({ type: "RUN_STARTED" }) + frame({ type: "RUN_FINISHED" }))).toEqual([{ type: "RUN_STARTED" }, { type: "RUN_FINISHED" }]);
  });

  it("buffers a frame split across chunks, including in the middle of the JSON", () => {
    const p = createSseParser();
    const whole = frame({ type: "TEXT_MESSAGE_CONTENT", delta: "héllo" });
    expect(p.feed(whole.slice(0, 20))).toEqual([]);
    expect(p.feed(whole.slice(20))).toEqual([{ type: "TEXT_MESSAGE_CONTENT", delta: "héllo" }]);
  });

  it("handles CRLF, comments and non-event noise", () => {
    const p = createSseParser();
    expect(p.feed(`: ping\r\n\r\ndata: {"type":"X"}\r\n\r\ndata: not json\n\ndata: {"nope":1}\n\n`)).toEqual([{ type: "X" }]);
  });

  it("flushes a trailing frame without a blank line on end", () => {
    const p = createSseParser();
    expect(p.feed('data: {"type":"RUN_FINISHED"}')).toEqual([]);
    expect(p.end()).toEqual([{ type: "RUN_FINISHED" }]);
    expect(p.end()).toEqual([]);
  });
});

describe("readEvents", () => {
  it("decodes a byte stream split mid-character", async () => {
    const bytes = new TextEncoder().encode(frame({ type: "TEXT_MESSAGE_CONTENT", delta: "€400" }));
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 45));
        c.enqueue(bytes.slice(45));
        c.close();
      },
    });
    const out = [];
    for await (const e of readEvents(body)) out.push(e);
    expect(out).toEqual([{ type: "TEXT_MESSAGE_CONTENT", delta: "€400" }]);
  });
});

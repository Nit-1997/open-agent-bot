import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPiSession } from "../../src/pi/createPiSession.js";
import { ProviderHub } from "../../src/providers/hub.js";

let server: Server;
const bodies: { messages: { role: string; content: unknown }[] }[] = [];
let hub: ProviderHub;

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (!raw) return res.writeHead(404).end();
      bodies.push(JSON.parse(raw));
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (delta: object, finish: string | null = null) =>
        `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      res.write(chunk({ role: "assistant", content: "done" }));
      res.write(chunk({}, "stop"));
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  hub = await ProviderHub.create({
    dataDir: mkdtempSync(join(tmpdir(), "wsctx-")),
    litellm: {
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
      apiKey: "none",
      models: [{ id: "m", label: "m" }],
    },
  });
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

const textOf = (c: unknown) => (typeof c === "string" ? c : (c as { text?: string }[]).map((p) => p.text ?? "").join(""));

describe("pi session with a workspace", () => {
  it("shows the model the current note on the latest user message only, never stored in the transcript, and replays restored history", async () => {
    const model = hub.resolve("litellm/m") ?? hub.resolve("m");
    if (!model) throw new Error("no model");
    let note: string | undefined = "<workspace>\nevent main: party, 12 guests\n</workspace>";
    const handle = await createPiSession({
      runtime: hub.runtime,
      model,
      systemPrompt: "sys",
      tools: [],
      history: [
        { role: "user", text: "plan a party" },
        { role: "assistant", text: "Here is the plan." },
      ],
      contextNote: () => note,
    });
    try {
      await handle.session.prompt("make it 16 kids");
      note = "<workspace>\nevent main: party, 16 guests\n</workspace>";
      await handle.session.prompt("and cake");

      const first = bodies.at(-2)!.messages;
      const second = bodies.at(-1)!.messages;
      expect(first.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
      expect(textOf(first[1].content)).toBe("plan a party");
      expect(textOf(first[2].content)).toBe("Here is the plan.");
      expect(textOf(first[3].content)).toBe("<workspace>\nevent main: party, 12 guests\n</workspace>\n\nmake it 16 kids");

      expect(second.map((m) => m.role)).toEqual(["system", "user", "assistant", "user", "assistant", "user"]);
      expect(textOf(second[3].content)).toBe("make it 16 kids");
      expect(textOf(second[5].content)).toBe("<workspace>\nevent main: party, 16 guests\n</workspace>\n\nand cake");
      expect(JSON.stringify(handle.session.messages)).not.toContain("<workspace>");
    } finally {
      await handle.dispose();
    }
  });

  it("sends the prompt untouched when there is nothing to note", async () => {
    const model = hub.resolve("litellm/m") ?? hub.resolve("m");
    if (!model) throw new Error("no model");
    const handle = await createPiSession({ runtime: hub.runtime, model, systemPrompt: "sys", tools: [], contextNote: () => undefined });
    try {
      await handle.session.prompt("hi");
      expect(textOf(bodies.at(-1)!.messages.at(-1)!.content)).toBe("hi");
    } finally {
      await handle.dispose();
    }
  });
});

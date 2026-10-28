import { describe, expect, it } from "vitest";
import { liveSession } from "./liveSession.js";

const live = !!process.env.LLM_BASE_URL;

describe.skipIf(!live)("createPiSession (live LiteLLM)", () => {
  it("answers using the given system prompt with no built-in tools", async () => {
    const handle = await liveSession("Reply with exactly: pong", []);
    try {
      for (const t of ["read", "bash", "edit", "write", "grep", "find", "ls"]) {
        expect(handle.session.getActiveToolNames()).not.toContain(t);
      }
      await handle.session.prompt("ping");
      expect(handle.session.getLastAssistantText()?.toLowerCase()).toContain("pong");
    } finally {
      await handle.dispose();
    }
  }, 120000);
});

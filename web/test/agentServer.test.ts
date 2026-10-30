import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("agentSecret", () => {
  it("prefers AGENT_SHARED_SECRET", async () => {
    vi.stubEnv("AGENT_SHARED_SECRET", "from-env");
    const { agentSecret } = await import("@/lib/agentServer");
    expect(agentSecret(() => "from-file")).toBe("from-env");
  });

  it("reads the secret the agent generated on the shared volume, once it exists", async () => {
    vi.stubEnv("AGENT_SHARED_SECRET", "");
    vi.stubEnv("AGENT_SECRET_FILE", "/vol/agent-secret");
    const { agentHeaders, agentSecret } = await import("@/lib/agentServer");
    const missing = () => {
      throw new Error("ENOENT");
    };
    expect(agentSecret(missing)).toBeUndefined();
    const read = vi.fn((p: string) => (p === "/vol/agent-secret" ? "abc\n" : ""));
    expect(agentSecret(read)).toBe("abc");
    expect(agentSecret(read)).toBe("abc");
    expect(read).toHaveBeenCalledTimes(1);
    expect(agentHeaders({ a: "1" })).toEqual({ a: "1", "x-agent-secret": "abc" });
  });
});

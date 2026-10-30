import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { pickModel } from "../../src/session/createSession.js";

const model = (provider: string, id: string) => ({ provider, id }) as never;

function hub(models: Record<string, unknown>, enabled: string[] = []) {
  return { resolve: (ref: string) => models[ref] as never, enabledModels: () => enabled.map((id) => ({ id, label: id, provider: "p" })) };
}

describe("pickModel", () => {
  const cfg = loadConfig({ AGENT_MODEL: "chat-default" });

  it("uses the chat's model when it resolves, else the configured default", () => {
    const h = hub({ "openai/gpt": model("openai", "gpt"), "litellm/chat-default": model("litellm", "chat-default") });
    expect(pickModel(cfg, h, "openai/gpt")).toEqual({ provider: "openai", id: "gpt" });
    expect(pickModel(cfg, h, "gone/model")).toEqual({ provider: "litellm", id: "chat-default" });
  });

  it("falls back to the first enabled model, and says what to do when there is none", () => {
    expect(pickModel(cfg, hub({ "groq/x": model("groq", "x") }, ["groq/x"]), undefined)).toEqual({ provider: "groq", id: "x" });
    expect(() => pickModel(cfg, hub({}), undefined)).toThrow(/No model is set up yet/);
  });
});

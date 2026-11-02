import { describe, expect, it } from "vitest";
import { defaultModelRef, joinNotes, pickModel } from "../../src/session/createSession.js";

const model = (provider: string, id: string) => ({ provider, id }) as never;

function hub(models: Record<string, unknown>) {
  return { resolve: (ref: string) => models[ref] as never };
}

describe("pickModel", () => {
  const h = hub({ "openai/gpt": model("openai", "gpt"), "groq/x": model("groq", "x") });

  it("uses the chat's model when it resolves, else the model chosen in the profile", () => {
    expect(pickModel(h, "openai/gpt", "groq/x")).toEqual({ provider: "openai", id: "gpt" });
    expect(pickModel(h, "gone/model", "groq/x")).toEqual({ provider: "groq", id: "x" });
    expect(pickModel(h, undefined, "groq/x")).toEqual({ provider: "groq", id: "x" });
  });

  it("never guesses a model: with none chosen it says to pick one", () => {
    expect(() => pickModel(h, undefined, undefined)).toThrow("Pick a model in Settings → Models.");
    expect(() => pickModel(h, undefined, "removed/model")).toThrow("Pick a model in Settings → Models.");
  });
});

describe("defaultModelRef", () => {
  it("reports the profile's model only while it is still available", () => {
    const h = hub({ "groq/x": model("groq", "x") });
    expect(defaultModelRef(h, "groq/x")).toBe("groq/x");
    expect(defaultModelRef(h, "openai/gone")).toBeNull();
    expect(defaultModelRef(h, undefined)).toBeNull();
  });
});

describe("joinNotes", () => {
  it("joins the notes that are present with a blank line, in order", () => {
    expect(joinNotes("<workspace>a</workspace>", "<open_report>b</open_report>")).toBe(
      "<workspace>a</workspace>\n\n<open_report>b</open_report>",
    );
    expect(joinNotes(undefined, "<open_report>b</open_report>")).toBe("<open_report>b</open_report>");
    expect(joinNotes("<workspace>a</workspace>", undefined)).toBe("<workspace>a</workspace>");
    expect(joinNotes("", "x")).toBe("x");
  });

  it("gives undefined when no note is present, so no context message is added", () => {
    expect(joinNotes()).toBeUndefined();
    expect(joinNotes(undefined, undefined)).toBeUndefined();
    expect(joinNotes("", undefined)).toBeUndefined();
  });
});

import { describe, it } from "vitest";

describe("createGuards", () => {
  it.todo("hands the raw request to admitCaller and lets an admitted caller through");
  it.todo("renders the admitCaller refusal verbatim and never authenticates");
  it.todo("renders any other admitCaller refusal with its own kind and code");
  it.todo("renders the authenticate error verbatim and never runs the handler");
  it.todo("puts the authenticated principal on the context");
});

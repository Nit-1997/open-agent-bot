import { describe, it } from "vitest";

describe("hostedAgentDeps", () => {
  it.todo("listens on every interface with a hosted identity, the config port and the hosted mounts");
  it.todo("refuses an identity that is not hosted");
  it.todo("offers the gateway only when an LLM key is configured");
});

describe("adminHooks", () => {
  it.todo("invalidates the status and then forgets the user when an account is disabled");
  it.todo("only invalidates the status when an account is enabled again");
});

describe("hostedGateway", () => {
  it.todo("is undefined without an API key");
  it.todo("carries the base URL, key and models with one");
});

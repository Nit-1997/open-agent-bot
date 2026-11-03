import { describe, it } from "vitest";

describe("startAgent", () => {
  it.todo("listens on 127.0.0.1 by default and answers /health");
  it.todo("listens on the host it is given");
  it.todo("serves no admin or access routes without mounts");
  it.todo("frees the port on close and shuts down in order with store.close last");
  it.todo("starts with the hosted mounts");
});

describe("startAgent mount refusals", () => {
  it.todo("refuses a public route on %s");
  it.todo("refuses public middleware on every path");
  it.todo("refuses the protected basePath %j");
  it.todo("refuses a protected route outside basePath: %s");
  it.todo("accepts public routes that miss every user path and protected routes under basePath");
});

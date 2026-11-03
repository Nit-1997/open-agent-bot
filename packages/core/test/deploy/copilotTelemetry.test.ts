import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DOCKERFILE = readFileSync(join(import.meta.dirname, "../../Dockerfile"), "utf8");
const AGENT_ENV_EXAMPLE = readFileSync(join(import.meta.dirname, "../../../../deploy-config/env.examples/agent.env.example"), "utf8");

describe("agent image", () => {
  it("turns CopilotKit telemetry off before the agent starts", () => {
    const lines = DOCKERFILE.split("\n");
    const env = lines.findIndex((l) => l.trim() === "ENV COPILOTKIT_TELEMETRY_DISABLED=true");
    expect(env).toBeGreaterThan(-1);
    expect(env).toBeLessThan(lines.findIndex((l) => l.startsWith("CMD ")));
    expect(env).toBeGreaterThan(lines.findLastIndex((l) => l.startsWith("FROM ")));
  });

  it("ships the agent env example with telemetry off, so a copied file starts", () => {
    const lines = AGENT_ENV_EXAMPLE.split("\n").filter((l) => l.startsWith("COPILOTKIT_TELEMETRY_DISABLED="));
    expect(lines).toEqual(["COPILOTKIT_TELEMETRY_DISABLED=true"]);
  });
});

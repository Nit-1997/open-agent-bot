import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DOCKERFILE = readFileSync(join(import.meta.dirname, "../../Dockerfile"), "utf8");

describe("agent image", () => {
  it("turns CopilotKit telemetry off before the agent starts", () => {
    const lines = DOCKERFILE.split("\n");
    const env = lines.findIndex((l) => l.trim() === "ENV COPILOTKIT_TELEMETRY_DISABLED=true");
    expect(env).toBeGreaterThan(-1);
    expect(env).toBeLessThan(lines.findIndex((l) => l.startsWith("CMD ")));
    expect(env).toBeGreaterThan(lines.findLastIndex((l) => l.startsWith("FROM ")));
  });
});

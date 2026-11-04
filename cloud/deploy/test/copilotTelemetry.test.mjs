import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const AGENT_ENV_EXAMPLE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../deploy-config/env-files/backend/.env.example"),
  "utf8",
);

describe("agent image", () => {
  it("ships the backend env example with telemetry off, so a copied file starts", () => {
    const lines = AGENT_ENV_EXAMPLE.split("\n").filter((l) => l.startsWith("COPILOTKIT_TELEMETRY_DISABLED="));
    assert.deepEqual(lines, ["COPILOTKIT_TELEMETRY_DISABLED=true"]);
  });
});

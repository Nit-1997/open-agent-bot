import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultTarget, transportFor } from "../../../../packages/core/evals/run.js";
import { CLI_TARGETS } from "../../evals/run.js";

const ROOT = join(import.meta.dirname, "../../../..");

describe("cloud evals CLI", () => {
  it("registers hosted on core's runner, which stays the CLI default", () => {
    expect(Object.keys(CLI_TARGETS)).toEqual(["hosted"]);
    expect(defaultTarget(CLI_TARGETS)).toBe("hosted");
  });

  it("refuses an unknown target and names hosted and local", async () => {
    await expect(transportFor({ target: "cloud", url: "", repoRoot: ROOT, env: {} }, CLI_TARGETS)).rejects.toThrow(
      /--target must be hosted or local/,
    );
  });
});

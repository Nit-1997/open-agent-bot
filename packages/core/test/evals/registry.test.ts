import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUILT_IN_TARGETS, CLI_TARGETS, defaultTarget, main, type TransportInput, transportFor } from "../../evals/run.js";
import type { Transport } from "../../evals/types.js";

const CORE = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ORIGIN = "http://127.0.0.1:18341";

const stub =
  (calls: TransportInput[], url = "http://stub.test/run") =>
  async (input: TransportInput): Promise<Transport> => {
    calls.push(input);
    return { url, headers: async () => ({}) };
  };

describe("evals target registry", () => {
  it("builds in only the local target", () => {
    expect(Object.keys(BUILT_IN_TARGETS)).toEqual(["local"]);
  });

  it("serves local with nothing registered", async () => {
    const t = await transportFor({ target: "local", url: "", origin: ORIGIN, repoRoot: CORE, env: {} }, {});
    expect(t.url).toBe(`${ORIGIN}/api/copilotkit/agent/openagent/run`);
  });

  it("refuses an unknown target and names the registered ones", async () => {
    await expect(transportFor({ target: "cloud", url: "", repoRoot: CORE, env: {} }, {})).rejects.toThrow(
      "--target must be local; got 'cloud'",
    );
    await expect(transportFor({ target: "cloud", url: "", repoRoot: CORE, env: {} }, { hosted: stub([]) })).rejects.toThrow(
      "--target must be hosted or local; got 'cloud'",
    );
    await expect(transportFor({ target: "toString", url: "", repoRoot: CORE, env: {} }, {})).rejects.toThrow(
      "--target must be local; got 'toString'",
    );
  });

  it("refuses a registered target that would replace the built-in local one", async () => {
    await expect(transportFor({ target: "local", url: "", origin: ORIGIN, repoRoot: CORE, env: {} }, { local: stub([]) })).rejects.toThrow(
      "the local target is built in and can't be registered",
    );
  });

  it("hands the input to a registered target", async () => {
    const calls: TransportInput[] = [];
    const input = { target: "hosted", url: "http://127.0.0.1:18800/agui", repoRoot: CORE, env: {} };
    const t = await transportFor(input, { hosted: stub(calls) });
    expect(t.url).toBe("http://stub.test/run");
    expect(calls).toEqual([input]);
  });

  it("defaults to the first registered target, else local", () => {
    expect(defaultTarget({})).toBe("local");
    expect(defaultTarget({ hosted: stub([]) })).toBe("hosted");
  });

  it("has the CLI wrapper register hosted, which stays the CLI default", () => {
    expect(Object.keys(CLI_TARGETS)).toEqual(["hosted"]);
    expect(defaultTarget(CLI_TARGETS)).toBe("hosted");
  });
});

describe("evals main", () => {
  it("refuses an unknown --target before writing anything", async () => {
    await expect(main(["--target", "nope"], {})).rejects.toThrow("--target must be local; got 'nope'");
  });

  it("uses the default target when --target is not given", async () => {
    const calls: TransportInput[] = [];
    const refuse = async (input: TransportInput): Promise<Transport> => {
      calls.push(input);
      throw new Error("stub target stops the run");
    };
    await expect(main(["--url", "http://127.0.0.1:18800/agui"], { hosted: refuse })).rejects.toThrow("stub target stops the run");
    expect(calls.map((c) => [c.target, c.url])).toEqual([["hosted", "http://127.0.0.1:18800/agui"]]);
  });
});

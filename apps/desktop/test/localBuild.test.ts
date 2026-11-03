import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dockerBuilds, hostArchFlag, localLock, localRefs, localVersion, parseLocalBuildArgs } from "../scripts/localBuildLib.mjs";
import { validatePins } from "../src/main/services.ts";

const COMPOSE = "c".repeat(64);
const IDS = { agent: `sha256:${"a".repeat(64)}`, search: `sha256:${"b".repeat(64)}` };

describe("dist:local (D22)", () => {
  it("uses the production local refs by default and oab- prefixed refs in test mode", () => {
    expect(localRefs()).toEqual({ agent: "open-agent:local", search: "open-agent-search:local" });
    expect(localRefs("oab-m4-")).toEqual({ agent: "oab-m4-open-agent:local", search: "oab-m4-open-agent-search:local" });
  });

  it("parses its options and refuses an unsafe prefix or a test-mode run without one", () => {
    expect(parseLocalBuildArgs([], {})).toEqual({ ok: true, opts: { dist: true } });
    expect(parseLocalBuildArgs(["--tag-prefix", "oab-m4-", "--lock-out", "/tmp/l.json", "--no-dist"], {})).toEqual({
      ok: true,
      opts: { prefix: "oab-m4-", lockOut: "/tmp/l.json", dist: false },
    });
    expect(parseLocalBuildArgs(["--tag-prefix", "open-"], {})).toEqual({
      ok: false,
      reason: "--tag-prefix must match ^oab-[a-z0-9-]*-$, got open-",
    });
    expect(parseLocalBuildArgs([], { OPEN_AGENT_SHELL_TEST: "1" })).toEqual({
      ok: false,
      reason: "OPEN_AGENT_SHELL_TEST=1 needs --tag-prefix oab-…: a test run never writes open-agent:local",
    });
    expect(parseLocalBuildArgs(["--lock-out", "rel.json"], {})).toEqual({ ok: false, reason: "--lock-out must be an absolute path" });
    expect(parseLocalBuildArgs(["--dist-only"], {}).ok).toBe(false);
  });

  it("names the version after the commit and marks a dirty tree", () => {
    expect(localVersion("abc1234", false)).toBe("local-abc1234");
    expect(localVersion("abc1234", true)).toBe("local-abc1234-dirty");
    expect(() => localVersion("not a sha", false)).toThrow(/short sha/);
  });

  it("builds both images with plain docker build, never compose", () => {
    expect(dockerBuilds(localRefs("oab-m4-"), "local-abc1234")).toEqual([
      ["build", "-f", "packages/core/Dockerfile", "--build-arg", "OPEN_AGENT_VERSION=local-abc1234", "-t", "oab-m4-open-agent:local", "."],
      ["build", "--build-arg", "OPEN_AGENT_VERSION=local-abc1234", "-t", "oab-m4-open-agent-search:local", "local/searxng"],
    ]);
    for (const args of dockerBuilds(localRefs(), "local-abc1234")) expect(args).not.toContain("compose");
  });

  it("writes a kind:local lock the shell accepts outside test mode only with the production refs", () => {
    const lock = localLock({ version: "local-abc1234", composeSha256: COMPOSE, refs: localRefs(), ids: IDS });
    expect(lock).toEqual({
      schema: 1,
      kind: "local",
      version: "local-abc1234",
      composeSha256: COMPOSE,
      images: { agent: "open-agent:local", search: "open-agent-search:local" },
      imageIds: IDS,
      pull: false,
    });
    const ctx = { composeSha256: COMPOSE, shellVersion: "0.0.0-dev" };
    expect(validatePins(lock, { ...ctx, test: false })).toMatchObject({ ok: true, pins: { kind: "local", pull: false } });
    const test = localLock({ version: "local-abc1234", composeSha256: COMPOSE, refs: localRefs("oab-m4-"), ids: IDS });
    expect(validatePins(test, { ...ctx, test: true })).toMatchObject({ ok: true, pins: { kind: "local" } });
    expect(validatePins(test, { ...ctx, test: false })).toEqual({ ok: false, reason: "local_refs" });
    expect(() => localLock({ version: "local-abc1234", composeSha256: COMPOSE, refs: localRefs(), ids: { ...IDS, agent: "abc" } })).toThrow(
      /image Id/,
    );
  });

  it("packages for the host arch only", () => {
    expect(hostArchFlag("arm64")).toBe("--arm64");
    expect(hostArchFlag("x64")).toBe("--x64");
    expect(() => hostArchFlag("ia32")).toThrow(/arm64 or x64/);
  });

  it("is wired as npm run dist:local", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["dist:local"]).toBe("node scripts/local-build.mjs");
  });
});

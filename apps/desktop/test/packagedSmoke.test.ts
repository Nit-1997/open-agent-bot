import { describe, expect, it } from "vitest";
import {
  checkFuses,
  checkPlist,
  composeStopRecorded,
  composeSubcommands,
  EXPECTED_FUSES,
  launchTargetProblems,
  parseFuses,
  SIZE_BUDGET,
  sizeProblems,
  smokeEnv,
  statusProblems,
} from "../scripts/packagedSmokeLib.mjs";

const READ = `Analyzing app: Open Agent.app
Fuse Version: v1
  RunAsNode is Disabled
  EnableCookieEncryption is Disabled
  EnableNodeOptionsEnvironmentVariable is Disabled
  EnableNodeCliInspectArguments is Disabled
  EnableEmbeddedAsarIntegrityValidation is Enabled
  OnlyLoadAppFromAsar is Enabled
  LoadBrowserProcessSpecificV8Snapshot is Disabled
  GrantFileProtocolExtraPrivileges is Disabled
  WasmTrapHandlers is Enabled
`;

describe("packaged smoke helpers", () => {
  it("parses @electron/fuses read output", () => {
    expect(parseFuses(READ)).toMatchObject({ RunAsNode: false, OnlyLoadAppFromAsar: true, WasmTrapHandlers: true });
  });

  it("accepts exactly the D4 fuses", () => {
    expect(checkFuses(parseFuses(READ))).toEqual([]);
    expect(EXPECTED_FUSES).toEqual({
      RunAsNode: false,
      EnableCookieEncryption: false,
      EnableNodeOptionsEnvironmentVariable: false,
      EnableNodeCliInspectArguments: false,
      EnableEmbeddedAsarIntegrityValidation: true,
      OnlyLoadAppFromAsar: true,
      LoadBrowserProcessSpecificV8Snapshot: false,
      GrantFileProtocolExtraPrivileges: false,
    });
  });

  it("reports a flipped or missing fuse", () => {
    const fuses = parseFuses(READ.replace("RunAsNode is Disabled", "RunAsNode is Enabled").replace(/.*OnlyLoadAppFromAsar.*\n/, ""));
    expect(checkFuses(fuses)).toEqual(["fuse RunAsNode is true, expected false", "fuse OnlyLoadAppFromAsar is missing"]);
  });

  it("checks the plist identity", () => {
    expect(
      checkPlist(
        { CFBundleIdentifier: "ai.worksimulation.openagent", CFBundleName: "Open Agent", CFBundleShortVersionString: "0.0.0-dev" },
        "0.0.0-dev",
      ),
    ).toEqual([]);
    expect(
      checkPlist(
        { CFBundleIdentifier: "com.github.electron", CFBundleName: "Electron", CFBundleShortVersionString: "45.2.1" },
        "0.0.0-dev",
      ),
    ).toHaveLength(3);
  });

  it("holds the D17 size budget", () => {
    expect(SIZE_BUDGET).toEqual({ dmg: 140_000_000, app: 320_000_000, asar: 5_000_000 });
    expect(sizeProblems({ app: 260_000_000, asar: 100_000, dmg: 120_000_000 })).toEqual([]);
    expect(sizeProblems({ app: 330_000_000, asar: 6_000_000, dmg: 150_000_000 })).toHaveLength(3);
    expect(sizeProblems({ app: 260_000_000, asar: 100_000 })).toEqual([]);
  });
});

describe("packaged smoke launch helpers", () => {
  const base = { stateDir: "/tmp/oab-smoke/state", project: "oab-smoke", range: "18488-18489", docker: "/tmp/oab-smoke/bin/docker" };

  it("refuses targets outside the test guardrails", () => {
    expect(launchTargetProblems(base, "/Users/me")).toEqual([]);
    expect(launchTargetProblems({ ...base, project: "open-agent" }, "/Users/me")).toEqual([
      "project must match ^oab-[a-z0-9-]+$, got open-agent",
    ]);
    expect(launchTargetProblems({ ...base, range: "41100-41199" }, "/Users/me")).toEqual([
      "port range must be a-b inside 18000-19999, got 41100-41199",
    ]);
    expect(launchTargetProblems({ ...base, range: "18489-18488" }, "/Users/me")).toHaveLength(1);
    expect(launchTargetProblems({ ...base, stateDir: "/Users/me/Library/Application Support/Open Agent" }, "/Users/me")).toEqual([
      "state dir must not be under /Users/me/Library",
    ]);
    expect(launchTargetProblems({ ...base, stateDir: "relative" }, "/Users/me")).toEqual(["state dir must be absolute"]);
    expect(launchTargetProblems({ ...base, docker: "docker" }, "/Users/me")).toEqual(["docker must be an absolute path"]);
  });

  it("builds a test-mode environment with oab- names and nothing inherited that could attach a debugger", () => {
    const env = smokeEnv(
      { ...base, services: "/tmp/oab-smoke/dev-services.json" },
      { PATH: "/usr/bin:/bin", HOME: "/Users/me", NODE_OPTIONS: "--inspect", ELECTRON_RUN_AS_NODE: "1", COMPOSE_PROJECT_NAME: "evil" },
    );
    expect(env).toEqual({
      PATH: "/usr/bin:/bin",
      HOME: "/Users/me",
      TMPDIR: "/tmp",
      OPEN_AGENT_SHELL_TEST: "1",
      OPEN_AGENT_SHELL_STATE_DIR: "/tmp/oab-smoke/state",
      OPEN_AGENT_SHELL_PROJECT: "oab-smoke",
      OPEN_AGENT_SHELL_DATA_VOLUME: "oab-smoke-data",
      OPEN_AGENT_SHELL_KEYS_VOLUME: "oab-smoke-keys",
      OPEN_AGENT_SHELL_PORT_RANGE: "18488-18489",
      OPEN_AGENT_SHELL_DOCKER: "/tmp/oab-smoke/bin/docker",
      OPEN_AGENT_SHELL_EXTERNAL_LOG: "/tmp/oab-smoke/state/external.log",
      OPEN_AGENT_SHELL_SAVE_PATH: "/tmp/oab-smoke/state/saved.bin",
      OPEN_AGENT_SHELL_SERVICES: "/tmp/oab-smoke/dev-services.json",
    });
    expect(smokeEnv(base, { PATH: "/bin", HOME: "/h", TMPDIR: "/var/t" })).not.toHaveProperty("OPEN_AGENT_SHELL_SERVICES");
    expect(smokeEnv(base, { PATH: "/bin", HOME: "/h", TMPDIR: "/var/t" }).TMPDIR).toBe("/var/t");
  });

  it("finds a finished compose stop in calls.jsonl, ignoring start records and other subcommands", () => {
    const rec = (argv: string[], extra: Record<string, unknown> = {}) => JSON.stringify({ argv, envNames: [], pid: 1, ...extra });
    const prefix = ["compose", "-p", "oab-smoke", "-f", "/s/docker-compose.yml", "--project-directory", "/s", "--env-file", "/dev/null"];
    const only = [rec([...prefix, "ps"], { exitCode: 0 }), rec([...prefix, "stop"], { phase: "start" })].join("\n");
    expect(composeStopRecorded(only)).toBe(false);
    expect(composeStopRecorded(`${only}\n${rec([...prefix, "stop"], { exitCode: 0 })}\n`)).toBe(true);
    expect(composeStopRecorded("not json\n")).toBe(false);
  });

  it("lists the compose subcommands a launch issued, for the moved-app check", () => {
    const rec = (argv: string[]) => JSON.stringify({ argv, envNames: [], pid: 1, exitCode: 0 });
    const p = ["compose", "-p", "oab-smoke", "--env-file", "/dev/null"];
    const text = [rec(["version"]), rec([...p, "ps", "-a"]), rec([...p, "up", "-d"]), rec([...p, "start"])].join("\n");
    expect(composeSubcommands(text)).toEqual(["ps", "up", "start"]);
  });

  it("checks the status file for the app screen and, for a local build, the version and the logged title", () => {
    expect(statusProblems({ screen: "app", phase: "ready", port: 18488 }, "", {})).toEqual([]);
    expect(statusProblems({ screen: "screen-failed", phase: "failed" }, "", {})).toEqual([
      "status.json screen is screen-failed, expected app",
    ]);
    const local = { screen: "app", phase: "ready", port: 18484, servicesVersion: "local-abc1234" };
    expect(statusProblems(local, "[app] title Open Agent — Local build — test\n", { localBuild: true })).toEqual([]);
    expect(statusProblems({ ...local, servicesVersion: "dev" }, "[app] title Open Agent — test\n", { localBuild: true })).toEqual([
      "status.json servicesVersion is dev, expected local-<sha>",
      "shell.log has no '[app] title Open Agent — Local build — test' line",
    ]);
  });
});

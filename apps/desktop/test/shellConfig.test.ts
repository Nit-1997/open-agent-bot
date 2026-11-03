import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadShellConfig, OVERRIDE_VARS, ShellConfigError } from "../src/main/shellConfig.ts";

const HOME = "/Users/someone";
const real = { realUserData: join(HOME, "Library/Application Support/Open Agent"), realLogs: join(HOME, "Library/Logs/Open Agent") };

const testEnv = (extra: Record<string, string | undefined> = {}) => ({
  OPEN_AGENT_SHELL_TEST: "1",
  OPEN_AGENT_SHELL_STATE_DIR: "/tmp/oab-shell-state",
  OPEN_AGENT_SHELL_PROJECT: "oab-factory-m4",
  OPEN_AGENT_SHELL_DATA_VOLUME: "oab-factory-m4-data",
  OPEN_AGENT_SHELL_KEYS_VOLUME: "oab-factory-m4-keys",
  OPEN_AGENT_SHELL_PORT_RANGE: "18420-18429",
  ...extra,
});

describe("loadShellConfig outside test mode", () => {
  it("uses the fixed production defaults", () => {
    const cfg = loadShellConfig({}, real);
    expect(cfg).toMatchObject({
      test: false,
      project: "open-agent",
      dataVolume: "open-agent-data",
      keysVolume: "open-agent-keys",
      portRange: [41100, 41199],
      releasesUrl: "https://api.github.com/repos/Nit-1997/open-agent-bot/releases/latest",
      allowSystemSocket: false,
      ignored: [],
    });
    expect(cfg.stateDir).toBeUndefined();
    expect(cfg.dockerOverride).toBeUndefined();
  });

  it("lists every override variable", () => {
    expect([...OVERRIDE_VARS].sort()).toEqual(
      [
        "OPEN_AGENT_SHELL_STATE_DIR",
        "OPEN_AGENT_SHELL_DOCKER",
        "OPEN_AGENT_SHELL_PROJECT",
        "OPEN_AGENT_SHELL_DATA_VOLUME",
        "OPEN_AGENT_SHELL_KEYS_VOLUME",
        "OPEN_AGENT_SHELL_PORT_RANGE",
        "OPEN_AGENT_SHELL_SERVICES",
        "OPEN_AGENT_SHELL_RELEASES_URL",
        "OPEN_AGENT_SHELL_EXTERNAL_LOG",
        "OPEN_AGENT_SHELL_SAVE_PATH",
        "OPEN_AGENT_SHELL_SINGLE_INSTANCE_ID",
        "OPEN_AGENT_SHELL_ALLOW_SYSTEM_SOCKET",
        "OPEN_AGENT_SHELL_FAKE_LOCATION",
        "OPEN_AGENT_SHELL_EXTERNAL_WINDOW_MS",
        "OPEN_AGENT_SHELL_FAKE_APPS",
      ].sort(),
    );
  });

  for (const name of OVERRIDE_VARS) {
    it(`ignores ${name} and lists it by name`, () => {
      const value = name.endsWith("PORT_RANGE")
        ? "18420-18429"
        : name.endsWith("FAKE_LOCATION")
          ? "outside"
          : name.endsWith("SOCKET")
            ? "1"
            : name.endsWith("_MS")
              ? "100"
              : name.endsWith("FAKE_APPS")
                ? "docker-desktop"
                : "/tmp/x";
      const cfg = loadShellConfig({ [name]: value }, real);
      expect(cfg.test).toBe(false);
      expect(cfg.ignored).toEqual([name]);
      expect(cfg.project).toBe("open-agent");
      expect(cfg.stateDir).toBeUndefined();
      expect(cfg.dockerOverride).toBeUndefined();
      expect(cfg.externalLog).toBeUndefined();
      expect(cfg.savePath).toBeUndefined();
      expect(cfg.fakeOutside).toBe(false);
      expect(cfg.allowSystemSocket).toBe(false);
      expect(cfg.portRange).toEqual([41100, 41199]);
      expect(cfg.externalWindowMs).toBeUndefined();
      expect(cfg.fakeApps).toBeUndefined();
    });
  }

  it("OPEN_AGENT_SHELL_FAKE_APPS reports the Docker apps in test mode (none when unset)", () => {
    const env = {
      OPEN_AGENT_SHELL_TEST: "1",
      OPEN_AGENT_SHELL_STATE_DIR: "/tmp/oab-x",
      OPEN_AGENT_SHELL_PROJECT: "oab-x",
      OPEN_AGENT_SHELL_DATA_VOLUME: "oab-x-data",
      OPEN_AGENT_SHELL_KEYS_VOLUME: "oab-x-keys",
      OPEN_AGENT_SHELL_PORT_RANGE: "18420-18429",
    };
    expect(loadShellConfig(env, real).fakeApps).toEqual({ dockerDesktop: false, orbstack: false });
    expect(loadShellConfig({ ...env, OPEN_AGENT_SHELL_FAKE_APPS: "docker-desktop" }, real).fakeApps).toEqual({
      dockerDesktop: true,
      orbstack: false,
    });
    expect(loadShellConfig({ ...env, OPEN_AGENT_SHELL_FAKE_APPS: "orbstack,docker-desktop" }, real).fakeApps).toEqual({
      dockerDesktop: true,
      orbstack: true,
    });
    expect(() => loadShellConfig({ ...env, OPEN_AGENT_SHELL_FAKE_APPS: "colima" }, real)).toThrow(ShellConfigError);
  });

  it("OPEN_AGENT_SHELL_EXTERNAL_WINDOW_MS sets the link rate and de-duplication window in test mode, 0–60000 only", () => {
    const env = {
      OPEN_AGENT_SHELL_TEST: "1",
      OPEN_AGENT_SHELL_STATE_DIR: "/tmp/oab-x",
      OPEN_AGENT_SHELL_PROJECT: "oab-x",
      OPEN_AGENT_SHELL_DATA_VOLUME: "oab-x-data",
      OPEN_AGENT_SHELL_KEYS_VOLUME: "oab-x-keys",
      OPEN_AGENT_SHELL_PORT_RANGE: "18420-18429",
    };
    expect(loadShellConfig(env, real).externalWindowMs).toBeUndefined();
    expect(loadShellConfig({ ...env, OPEN_AGENT_SHELL_EXTERNAL_WINDOW_MS: "0" }, real).externalWindowMs).toBe(0);
    expect(loadShellConfig({ ...env, OPEN_AGENT_SHELL_EXTERNAL_WINDOW_MS: "1500" }, real).externalWindowMs).toBe(1500);
    for (const bad of ["-1", "60001", "1e3", "x"])
      expect(() => loadShellConfig({ ...env, OPEN_AGENT_SHELL_EXTERNAL_WINDOW_MS: bad }, real), bad).toThrow(ShellConfigError);
  });

  it("ignores OPEN_AGENT_SHELL_ALLOW_SYSTEM_SOCKET=1 outside test mode", () => {
    const cfg = loadShellConfig({ OPEN_AGENT_SHELL_ALLOW_SYSTEM_SOCKET: "1" }, real);
    expect(cfg.allowSystemSocket).toBe(false);
    expect(cfg.ignored).toContain("OPEN_AGENT_SHELL_ALLOW_SYSTEM_SOCKET");
  });

  it("refuses a test flag other than 1", () => {
    expect(() => loadShellConfig({ OPEN_AGENT_SHELL_TEST: "true" }, real)).toThrow(ShellConfigError);
    expect(() => loadShellConfig({ OPEN_AGENT_SHELL_TEST: "0" }, real)).toThrow(/OPEN_AGENT_SHELL_TEST/);
  });

  it("treats an empty test flag as unset", () => {
    expect(loadShellConfig({ OPEN_AGENT_SHELL_TEST: "" }, real).test).toBe(false);
  });
});

describe("loadShellConfig in test mode", () => {
  it("accepts a complete test configuration", () => {
    const cfg = loadShellConfig(
      testEnv({
        OPEN_AGENT_SHELL_DOCKER: "/tmp/fake/docker",
        OPEN_AGENT_SHELL_SERVICES: "/tmp/services.json",
        OPEN_AGENT_SHELL_RELEASES_URL: "http://127.0.0.1:18466/repos/x/releases/latest",
        OPEN_AGENT_SHELL_EXTERNAL_LOG: "/tmp/external.log",
        OPEN_AGENT_SHELL_SAVE_PATH: "/tmp/save.bin",
        OPEN_AGENT_SHELL_SINGLE_INSTANCE_ID: "spec-a",
        OPEN_AGENT_SHELL_ALLOW_SYSTEM_SOCKET: "1",
        OPEN_AGENT_SHELL_FAKE_LOCATION: "outside",
      }),
      real,
    );
    expect(cfg).toMatchObject({
      test: true,
      stateDir: "/tmp/oab-shell-state",
      project: "oab-factory-m4",
      dataVolume: "oab-factory-m4-data",
      keysVolume: "oab-factory-m4-keys",
      portRange: [18420, 18429],
      dockerOverride: "/tmp/fake/docker",
      servicesOverride: "/tmp/services.json",
      releasesUrl: "http://127.0.0.1:18466/repos/x/releases/latest",
      externalLog: "/tmp/external.log",
      savePath: "/tmp/save.bin",
      singleInstanceId: "spec-a",
      allowSystemSocket: true,
      fakeOutside: true,
      ignored: [],
    });
  });

  it("never points the release check at GitHub in test mode", () => {
    expect(loadShellConfig(testEnv(), real).releasesUrl).toBeUndefined();
  });

  const refusals: [string, Record<string, string | undefined>][] = [
    ["a missing state dir", { OPEN_AGENT_SHELL_STATE_DIR: undefined }],
    ["a relative state dir", { OPEN_AGENT_SHELL_STATE_DIR: "state" }],
    ["the real userData as state dir", { OPEN_AGENT_SHELL_STATE_DIR: real.realUserData }],
    ["a state dir under the real userData", { OPEN_AGENT_SHELL_STATE_DIR: join(real.realUserData, "x") }],
    ["a state dir under the real logs", { OPEN_AGENT_SHELL_STATE_DIR: join(real.realLogs, "x") }],
    ["a state dir that resolves into the real userData", { OPEN_AGENT_SHELL_STATE_DIR: `${real.realUserData}/../Open Agent/y` }],
    ["a missing project", { OPEN_AGENT_SHELL_PROJECT: undefined }],
    ["the real project", { OPEN_AGENT_SHELL_PROJECT: "open-agent" }],
    ["a project without oab-", { OPEN_AGENT_SHELL_PROJECT: "factory-m4" }],
    ["a project with upper case", { OPEN_AGENT_SHELL_PROJECT: "oab-Factory" }],
    ["a missing data volume", { OPEN_AGENT_SHELL_DATA_VOLUME: undefined }],
    ["the real data volume", { OPEN_AGENT_SHELL_DATA_VOLUME: "open-agent-data" }],
    ["a missing keys volume", { OPEN_AGENT_SHELL_KEYS_VOLUME: undefined }],
    ["the real keys volume", { OPEN_AGENT_SHELL_KEYS_VOLUME: "open-agent-keys" }],
    ["the same data and keys volume", { OPEN_AGENT_SHELL_KEYS_VOLUME: "oab-factory-m4-data" }],
    ["a missing port range", { OPEN_AGENT_SHELL_PORT_RANGE: undefined }],
    ["a port range outside 18000-19999", { OPEN_AGENT_SHELL_PORT_RANGE: "41100-41199" }],
    ["a port range that starts below 18000", { OPEN_AGENT_SHELL_PORT_RANGE: "17999-18010" }],
    ["a port range that ends above 19999", { OPEN_AGENT_SHELL_PORT_RANGE: "19990-20000" }],
    ["a reversed port range", { OPEN_AGENT_SHELL_PORT_RANGE: "18429-18420" }],
    ["a malformed port range", { OPEN_AGENT_SHELL_PORT_RANGE: "18420" }],
    ["a relative docker path", { OPEN_AGENT_SHELL_DOCKER: "docker" }],
    ["a relative services path", { OPEN_AGENT_SHELL_SERVICES: "services.json" }],
    ["a releases URL on GitHub", { OPEN_AGENT_SHELL_RELEASES_URL: "https://api.github.com/repos/x/releases/latest" }],
    ["a releases URL on another loopback port", { OPEN_AGENT_SHELL_RELEASES_URL: "http://127.0.0.1:3000/x" }],
    ["a releases URL on localhost", { OPEN_AGENT_SHELL_RELEASES_URL: "http://localhost:18466/x" }],
    ["a releases URL with userinfo", { OPEN_AGENT_SHELL_RELEASES_URL: "http://a:b@127.0.0.1:18466/x" }],
    ["a relative external log", { OPEN_AGENT_SHELL_EXTERNAL_LOG: "external.log" }],
    ["a relative save path", { OPEN_AGENT_SHELL_SAVE_PATH: "save.bin" }],
    ["a bad single-instance id", { OPEN_AGENT_SHELL_SINGLE_INSTANCE_ID: "../x" }],
    ["an allow-system-socket value other than 1", { OPEN_AGENT_SHELL_ALLOW_SYSTEM_SOCKET: "yes" }],
    ["a fake location other than outside", { OPEN_AGENT_SHELL_FAKE_LOCATION: "inside" }],
  ];

  for (const [label, extra] of refusals) {
    it(`refuses ${label}`, () => {
      expect(() => loadShellConfig(testEnv(extra), real)).toThrow(ShellConfigError);
    });
  }

  it("names the variable in the refusal", () => {
    expect(() => loadShellConfig(testEnv({ OPEN_AGENT_SHELL_PROJECT: "open-agent" }), real)).toThrow(/OPEN_AGENT_SHELL_PROJECT/);
  });
});

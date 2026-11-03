import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError } from "../../src/config.js";
import { loadLocalConfig } from "../../src/local/config.js";

const RENDERER = "c".repeat(64);
const TOKEN = "0123456789abcdef".repeat(4);
const BASE: NodeJS.ProcessEnv = { COPILOTKIT_TELEMETRY_DISABLED: "true" };

const load = (env: NodeJS.ProcessEnv = {}) => loadLocalConfig({ ...BASE, ...env }, { rendererSecret: RENDERER });

function problemsOf(env: NodeJS.ProcessEnv): string[] {
  try {
    load(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return (err as ConfigError).problems;
  }
  throw new Error("expected a ConfigError");
}

describe("loadLocalConfig defaults", () => {
  it("needs nothing but telemetry off", () => {
    const cfg = load();
    expect(cfg).toMatchObject({
      dataDir: "/data",
      keysDir: "/keys",
      rendererDir: "/run/open-agent/renderer",
      publicPort: 3000,
      listenHost: "0.0.0.0",
      listenPort: 3000,
      resetCredentials: false,
      rendererSecret: RENDERER,
      searxngUrl: "http://search:8080",
      rendererUrl: "http://renderer:8100",
    });
    expect(cfg.launchToken).toBeUndefined();
  });

  it("points the UI at the local-web build beside core", () => {
    expect(load().uiDir).toBe(resolve(import.meta.dirname, "../../../local-web/dist"));
  });

  it("never requires RENDERER_SECRET from the env", () => {
    expect(() => load()).not.toThrow();
  });

  it("reads every local setting", () => {
    const cfg = load({
      OPEN_AGENT_DATA_DIR: "/tmp/d",
      OPEN_AGENT_KEYS_DIR: "/tmp/k",
      OPEN_AGENT_RENDERER_DIR: "/tmp/r",
      OPEN_AGENT_UI_DIR: "/tmp/ui",
      OPEN_AGENT_PORT: "18330",
      OPEN_AGENT_LISTEN_HOST: "127.0.0.1",
      OPEN_AGENT_LISTEN_PORT: "0",
      OPEN_AGENT_LAUNCH_TOKEN: TOKEN,
      OPEN_AGENT_RESET_CREDENTIALS: "1",
    });
    expect(cfg).toMatchObject({
      dataDir: "/tmp/d",
      keysDir: "/tmp/k",
      rendererDir: "/tmp/r",
      uiDir: "/tmp/ui",
      publicPort: 18330,
      listenHost: "127.0.0.1",
      listenPort: 0,
      launchToken: TOKEN,
      resetCredentials: true,
    });
  });

  it("treats an empty launch token and an empty reset as off", () => {
    const cfg = load({ OPEN_AGENT_LAUNCH_TOKEN: "", OPEN_AGENT_RESET_CREDENTIALS: "" });
    expect(cfg.launchToken).toBeUndefined();
    expect(cfg.resetCredentials).toBe(false);
  });
});

describe("loadLocalConfig refusals", () => {
  it.each(["abc", TOKEN.toUpperCase(), TOKEN.slice(1), `${TOKEN}0`, ` ${TOKEN}x`])("refuses the launch token %j", (token) => {
    expect(problemsOf({ OPEN_AGENT_LAUNCH_TOKEN: token }).join()).toContain("OPEN_AGENT_LAUNCH_TOKEN");
  });

  it.each(["yes", "true", "0", "2"])("refuses OPEN_AGENT_RESET_CREDENTIALS=%s", (v) => {
    expect(problemsOf({ OPEN_AGENT_RESET_CREDENTIALS: v }).join()).toContain("OPEN_AGENT_RESET_CREDENTIALS");
  });

  it.each(["0", "70000", "abc", "-1", "3000.5", "1e3"])("refuses OPEN_AGENT_PORT=%s", (port) => {
    expect(problemsOf({ OPEN_AGENT_PORT: port }).join()).toContain("OPEN_AGENT_PORT");
  });

  it.each(["70000", "abc", "-1"])("refuses OPEN_AGENT_LISTEN_PORT=%s", (port) => {
    expect(problemsOf({ OPEN_AGENT_LISTEN_PORT: port }).join()).toContain("OPEN_AGENT_LISTEN_PORT");
  });

  it.each(["localhost", "192.168.1.2", "::"])("refuses OPEN_AGENT_LISTEN_HOST=%s", (host) => {
    expect(problemsOf({ OPEN_AGENT_LISTEN_HOST: host }).join()).toContain("OPEN_AGENT_LISTEN_HOST");
  });

  it.each(["OPEN_AGENT_DATA_DIR", "OPEN_AGENT_KEYS_DIR", "OPEN_AGENT_RENDERER_DIR", "OPEN_AGENT_UI_DIR"])(
    "refuses a relative %s",
    (name) => {
      expect(problemsOf({ [name]: join("relative", "dir") }).join()).toContain(name);
    },
  );

  it.each([
    ["SUPABASE_URL", "https://abcdefghijklmnopqrst.supabase.co"],
    ["SUPABASE_SECRET_KEY", "sb_secret_x"],
    ["SUPABASE_ANYTHING", "x"],
    ["AGENT_SERVICE_SECRET", "a".repeat(64)],
    ["CREDENTIAL_KEYS", `v1:${Buffer.alloc(32).toString("base64")}`],
    ["RENDERER_SECRET", "b".repeat(64)],
  ])("refuses the hosted setting %s, naming it but never its value", (name, value) => {
    const problems = problemsOf({ [name]: value });
    expect(problems.join()).toContain(name);
    expect(problems.join()).toContain("the local stack takes no hosted settings");
    expect(problems.join()).not.toContain(value);
  });

  it.each([[undefined], ["false"], [""], ["1"]])("refuses COPILOTKIT_TELEMETRY_DISABLED=%j", (v) => {
    const problems = (() => {
      try {
        loadLocalConfig({ COPILOTKIT_TELEMETRY_DISABLED: v }, { rendererSecret: RENDERER });
      } catch (err) {
        return (err as ConfigError).problems;
      }
      return [];
    })();
    expect(problems.join()).toContain("COPILOTKIT_TELEMETRY_DISABLED");
  });

  it("reports every problem at once", () => {
    const problems = problemsOf({ OPEN_AGENT_PORT: "0", SUPABASE_URL: "x", OPEN_AGENT_RESET_CREDENTIALS: "yes" });
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });
});

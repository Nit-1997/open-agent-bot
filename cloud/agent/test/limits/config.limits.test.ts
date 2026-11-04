import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConfigError } from "@oab/core/config.js";
import { LIMIT_RANGES, limitsFrom, limitsLine } from "../../src/limits/config.js";
import { testConfig } from "../fixtures/config.js";

const problemsOf = (env: NodeJS.ProcessEnv) => {
  const problems: string[] = [];
  const limits = limitsFrom(env, problems);
  return { limits, problems };
};

describe("request limit config", () => {
  it("defaults to 1 running per user, 10 per hour, 50 per month and 8 running on the server", () => {
    expect(testConfig().limits).toEqual({ runningPerUser: 1, perHour: 10, perMonth: 50, runningServer: 8 });
    expect(problemsOf({ LIMIT_RUNNING_PER_USER: "", LIMIT_REQUESTS_PER_HOUR: " " }).limits).toEqual({
      runningPerUser: 1,
      perHour: 10,
      perMonth: 50,
      runningServer: 8,
    });
  });

  it("reads each variable as an integer", () => {
    const cfg = testConfig({
      LIMIT_RUNNING_PER_USER: "4",
      LIMIT_REQUESTS_PER_HOUR: "1000",
      LIMIT_REQUESTS_PER_MONTH: "100000",
      LIMIT_RUNNING_SERVER: "50",
    });
    expect(cfg.limits).toEqual({ runningPerUser: 4, perHour: 1000, perMonth: 100000, runningServer: 50 });
  });

  it("accepts both ends of every range", () => {
    for (const [name, r] of Object.entries(LIMIT_RANGES)) {
      const low = name === "LIMIT_RUNNING_SERVER" ? { LIMIT_RUNNING_PER_USER: "1" } : {};
      expect(problemsOf({ ...low, [name]: String(r.min) }).problems).toEqual([]);
      const high = name === "LIMIT_RUNNING_PER_USER" ? { LIMIT_RUNNING_SERVER: "200" } : {};
      expect(problemsOf({ ...high, [name]: String(r.max) }).problems).toEqual([]);
    }
  });

  it.each([
    ["LIMIT_RUNNING_PER_USER", "0", "LIMIT_RUNNING_PER_USER must be a whole number from 1 to 10"],
    ["LIMIT_RUNNING_PER_USER", "11", "LIMIT_RUNNING_PER_USER must be a whole number from 1 to 10"],
    ["LIMIT_REQUESTS_PER_HOUR", "1001", "LIMIT_REQUESTS_PER_HOUR must be a whole number from 1 to 1000"],
    ["LIMIT_REQUESTS_PER_HOUR", "2.5", "LIMIT_REQUESTS_PER_HOUR must be a whole number from 1 to 1000"],
    ["LIMIT_REQUESTS_PER_MONTH", "-3", "LIMIT_REQUESTS_PER_MONTH must be a whole number from 1 to 100000"],
    ["LIMIT_REQUESTS_PER_MONTH", "1e3", "LIMIT_REQUESTS_PER_MONTH must be a whole number from 1 to 100000"],
    ["LIMIT_RUNNING_SERVER", "201", "LIMIT_RUNNING_SERVER must be a whole number from 1 to 200"],
    ["LIMIT_RUNNING_SERVER", "eight", "LIMIT_RUNNING_SERVER must be a whole number from 1 to 200"],
  ])("refuses %s=%s with a message naming the variable and the range", (name, value, message) => {
    expect(problemsOf({ [name]: value }).problems).toEqual([message]);
    expect(() => testConfig({ [name]: value })).toThrow(ConfigError);
    expect(() => testConfig({ [name]: value })).toThrow(message);
  });

  it("refuses a server cap below the per-user cap", () => {
    expect(problemsOf({ LIMIT_RUNNING_PER_USER: "5", LIMIT_RUNNING_SERVER: "4" }).problems).toEqual([
      "LIMIT_RUNNING_SERVER must be at least LIMIT_RUNNING_PER_USER",
    ]);
    expect(problemsOf({ LIMIT_RUNNING_PER_USER: "5", LIMIT_RUNNING_SERVER: "5" }).problems).toEqual([]);
  });

  it("never echoes the value it refused", () => {
    expect(() => testConfig({ LIMIT_RUNNING_SERVER: "sb_secret_oops" })).toThrow(/^(?!.*sb_secret_oops)/s);
  });

  it("logs one startup line", () => {
    expect(limitsLine(testConfig().limits)).toBe("[limits] running/user=1 hour=10 month=50 running/server=8");
  });

  it("lists the four variables with their defaults in the backend env example", () => {
    const example = readFileSync(new URL("../../../deploy-config/env-files/backend/.env.example", import.meta.url), "utf8");
    const listed = Object.fromEntries(
      example
        .split("\n")
        .filter((l) => l.startsWith("LIMIT_"))
        .map((l) => l.split("=")),
    );
    expect(listed).toEqual(Object.fromEntries(Object.entries(LIMIT_RANGES).map(([k, r]) => [k, String(r.fallback)])));
  });

  it("says in the env example header that only the fixed telemetry setting and the LIMIT_* defaults carry values", () => {
    const example = readFileSync(new URL("../../../deploy-config/env-files/backend/.env.example", import.meta.url), "utf8");
    const header = example.split("\n")[0];
    expect(header).not.toContain("Names only;");
    expect(header).toContain("LIMIT_*");
    const valued = example
      .split("\n")
      .filter((l) => /^[A-Z_]+=.+/.test(l))
      .map((l) => l.split("=")[0]);
    expect(valued.every((k) => k === "COPILOTKIT_TELEMETRY_DISABLED" || k.startsWith("LIMIT_"))).toBe(true);
  });
});

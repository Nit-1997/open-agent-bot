import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const enabled = process.platform === "darwin" && process.env.DESKTOP_PACKAGE === "1";
const run = (cmd: string, args: string[]) =>
  spawnSync(cmd, args, {
    cwd: APP,
    encoding: "utf8",
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
    maxBuffer: 64 * 1024 * 1024,
  });

describe("electron-builder.yml", () => {
  const config = parse(readFileSync(join(APP, "electron-builder.yml"), "utf8")) as {
    extraResources: { from: string; to: string }[];
    dmg: { artifactName: string };
  };

  it("ships the MIT LICENSE inside the app", () => {
    expect(config.extraResources).toContainEqual({ from: "../../LICENSE", to: "LICENSE" });
    expect(readFileSync(resolve(APP, "../../LICENSE"), "utf8")).toMatch(/^MIT License/);
  });

  it("keeps the stack resource and the DMG name", () => {
    expect(config.extraResources).toContainEqual({ from: "build/stack", to: "stack" });
    expect(config.dmg.artifactName).toMatch(/^Open-Agent-\$\{version\}-\$\{arch\}\.dmg$/);
  });
});

describe.skipIf(!enabled)("packaging (macOS, DESKTOP_PACKAGE=1)", () => {
  it(
    "builds unpacked arm64 and x64 apps that pass the static packaged smoke",
    () => {
      const dist = run("npm", ["run", "dist", "--", "--dir", "--arm64", "--x64"]);
      expect(dist.status, dist.stderr.slice(-4000)).toBe(0);
      const smoke = run(process.execPath, [
        "scripts/packagedSmoke.mjs",
        "--static",
        "--app",
        join(APP, "release/mac-arm64/Open Agent.app"),
        "--app",
        join(APP, "release/mac/Open Agent.app"),
      ]);
      expect(smoke.status, `${smoke.stdout}\n${smoke.stderr}`).toBe(0);
      expect(smoke.stdout).toContain("packaged smoke: ok");
    },
    15 * 60_000,
  );
});

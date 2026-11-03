import { describe, expect, it } from "vitest";
import { checkFuses, checkPlist, EXPECTED_FUSES, parseFuses, SIZE_BUDGET, sizeProblems } from "../scripts/packagedSmokeLib.mjs";

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

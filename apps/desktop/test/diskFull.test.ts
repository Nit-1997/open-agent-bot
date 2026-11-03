import { describe, expect, it } from "vitest";
import { diskHint, isDiskFull } from "../src/main/diskFull.ts";

describe("disk full (D21)", () => {
  it.each([
    "write /var/lib/docker/x: no space left on device",
    "SQLITE_FULL: database or disk is full",
    "Error: SQLITE_FULL",
    "ENOSPC: no space",
    "NO SPACE LEFT ON DEVICE",
  ])("matches %s", (t) => expect(isDiskFull(t)).toBe(true));

  it("matches ENOSPC errors and ignores others", () => {
    expect(isDiskFull(Object.assign(new Error("write failed"), { code: "ENOSPC" }))).toBe(true);
    expect(isDiskFull(Object.assign(new Error("nope"), { code: "EACCES" }))).toBe(false);
    expect(isDiskFull("port is already allocated")).toBe(false);
    expect(isDiskFull(undefined)).toBe(false);
  });

  it("gives one engine-specific line", () => {
    expect(diskHint("docker-desktop").line).toContain("Disk usage limit");
    expect(diskHint("colima").line).toContain("colima start --disk");
    expect(diskHint("orbstack").line).toContain("free space");
    expect(diskHint("rancher-desktop").line).toContain("Virtual Machine");
  });
});

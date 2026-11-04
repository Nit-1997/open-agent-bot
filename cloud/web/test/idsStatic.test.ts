import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const { ALLOWLIST, ID_ROOTS, REPO, scanIds } = await import(
  pathToFileURL(join(import.meta.dirname, "../../../scripts/ids-static.mjs")).href
);

const CLOUD_ROOTS = ["cloud/web/app", "cloud/web/components"];
const COMBINED_BASE_COUNT = 1005;

describe("static ids across the non-cloud roots and the hosted web app", () => {
  const scan = scanIds({ repo: REPO, roots: [...ID_ROOTS, ...CLOUD_ROOTS], allowlist: ALLOWLIST });

  it("gives every intrinsic JSX element an id", () => {
    expect(scan.missing).toEqual([]);
    expect(scan.elements.length).toBeGreaterThanOrEqual(COMBINED_BASE_COUNT);
  });

  it("finds elements in both cloud/web roots", () => {
    for (const root of CLOUD_ROOTS)
      expect(
        scan.elements.some((e: { file: string }) => e.file.startsWith(`${root}/`)),
        root,
      ).toBe(true);
  });

  it("uses every spread allowlist entry", () => {
    expect(scan.unusedAllowlist).toEqual([]);
  });
});

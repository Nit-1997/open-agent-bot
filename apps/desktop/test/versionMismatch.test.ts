import { describe, expect, it } from "vitest";
import type { ShellState } from "../src/shared/actions.ts";
import { type Block, screenModel } from "../src/shared/screenModel.ts";

const mismatch = (o: Partial<ShellState> = {}) =>
  screenModel({
    phase: "refused",
    screen: "screen-version-mismatch",
    test: true,
    versionMismatch: { expected: "1.4.0", found: "1.3.2" },
    ...o,
  });
const block = (blocks: readonly Block[], key: string) => blocks.find((b) => b.key === key);

describe("version mismatch screen", () => {
  it("says the services' version doesn't match and shows both versions", () => {
    const m = mismatch();
    expect(m.id).toBe("screen-version-mismatch");
    expect(m.title).toBe("The services don't match this version of Open Agent");
    expect(block(m.blocks, "versions")).toEqual({
      kind: "rows",
      key: "versions",
      rows: [
        { key: "expected", label: "This app expects", value: "1.4.0" },
        { key: "found", label: "The services report", value: "1.3.2" },
      ],
    });
    expect(block(m.blocks, "how")).toMatchObject({
      text: "Re-download the services to get version 1.4.0. If that doesn't help, get the latest Open Agent.",
    });
  });

  it("offers Re-download services first, then the latest release, Export, logs and Quit", () => {
    const m = mismatch();
    expect(m.buttons.map((b) => b.key)).toEqual(["update", "latest", "export", "logs", "quit"]);
    expect(m.buttons[0]).toMatchObject({ tone: "primary", action: { type: "updateServices" } });
    expect(m.buttons[1]?.action).toEqual({ type: "openLink", link: "release-page" });
  });

  it("says no version when the services report none", () => {
    const m = mismatch({ versionMismatch: { expected: "1.4.0" } });
    const rows = block(m.blocks, "versions");
    expect(rows && rows.kind === "rows" ? rows.rows[1]?.value : undefined).toBe("no version");
  });

  it("a local build is told to rebuild and gets Restart instead of a download", () => {
    const m = mismatch({
      localBuild: "Local build (local-abc1234)",
      versionMismatch: { expected: "local-abc1234", found: "local-def5678" },
    });
    expect(block(m.blocks, "how")).toMatchObject({
      text: "Rebuild this local build with npm run dist:local so its app and images match, then open it again.",
    });
    expect(m.buttons.map((b) => b.key)).toEqual(["restart", "export", "logs", "quit"]);
  });
});

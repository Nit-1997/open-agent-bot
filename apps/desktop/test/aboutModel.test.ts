import { describe, expect, it } from "vitest";
import type { ShellState } from "../src/shared/actions.ts";
import { aboutBlocks } from "../src/shared/aboutModel.ts";
import { type Block, screenModel } from "../src/shared/screenModel.ts";

const base: ShellState = {
  phase: "ready",
  screen: "screen-services",
  test: true,
  servicesVersion: "0.0.0-a",
  update: { appVersion: "0.0.0-dev" },
};
const find = (blocks: readonly Block[], key: string) => blocks.find((b) => b.key === key);
const text = (b: Block | undefined) => (b && "text" in b ? b.text : undefined);

describe("About section (D13, D14)", () => {
  it("shows versions, the launch-token sentence and the licence", () => {
    const blocks = aboutBlocks(base);
    expect(find(blocks, "about")).toEqual({
      kind: "rows",
      key: "about",
      rows: [
        { key: "app", label: "App version", value: "0.0.0-dev" },
        { key: "services", label: "Services version", value: "0.0.0-a" },
        { key: "licence", label: "Licence", value: "MIT" },
      ],
    });
    expect(text(find(blocks, "token"))).toBe(
      "A launch key that only this app knows protects your services: other users and programs on this Mac can't use them.",
    );
    expect(find(blocks, "update-row")).toBeUndefined();
  });

  it("an app update: update-row with Download and Later; Later is gone once dismissed", () => {
    const row = find(aboutBlocks({ ...base, update: { appVersion: "0.0.0-dev", shell: "99.0.0" } }), "update-row");
    expect(row).toEqual({
      kind: "row",
      key: "update-row",
      id: "update-row",
      text: "Open Agent 99.0.0 is available",
      buttons: [
        { key: "download", label: "Download", action: { type: "downloadUpdate" }, tone: "primary" },
        { key: "later", label: "Later", action: { type: "dismissUpdate" } },
      ],
    });
    const dismissed = find(aboutBlocks({ ...base, update: { appVersion: "0.0.0-dev", shell: "99.0.0", dismissed: true } }), "update-row");
    expect(dismissed && dismissed.kind === "row" ? dismissed.buttons.map((b) => b.key) : []).toEqual(["download"]);
  });

  it("service update states", () => {
    const svc = (s: Partial<ShellState>) => find(aboutBlocks({ ...base, ...s }), "services-update");
    expect(svc({})).toEqual({ kind: "p", key: "services-update", tone: "muted", text: "Up to date (0.0.0-a)" });
    expect(svc({ update: { appVersion: "0.0.0-dev", services: "0.0.0-b" } })).toEqual({
      kind: "row",
      key: "services-update",
      text: "Services 0.0.0-b are available",
      buttons: [{ key: "update", label: "Update services (0.0.0-b available)", action: { type: "updateServices" }, tone: "primary" }],
    });
    expect(svc({ update: { appVersion: "0.0.0-dev", incompatible: "compose_mismatch" } })).toEqual({
      kind: "p",
      key: "services-update",
      tone: "warn",
      text: "Service update not compatible: it needs a different compose file; update Open Agent first (compose_mismatch)",
    });
    expect(svc({ localBuild: "Local build (local-abc1234)", update: { appVersion: "0.0.0-dev", services: "9.0.0" } })).toEqual({
      kind: "p",
      key: "services-update",
      tone: "muted",
      text: "Not available for local builds",
    });
  });

  it("the check line: Couldn't check only after a manual check failed", () => {
    const check = (u: NonNullable<ShellState["update"]>) => find(aboutBlocks({ ...base, update: u }), "check");
    expect(check({ appVersion: "0.0.0-dev" })).toMatchObject({ kind: "row", text: "" });
    expect(check({ appVersion: "0.0.0-dev", checking: true })).toMatchObject({ text: "Checking…" });
    expect(check({ appVersion: "0.0.0-dev", error: "offline", checked: true })).toMatchObject({ text: "Couldn't check: offline" });
    expect(check({ appVersion: "0.0.0-dev", checked: true })).toMatchObject({ text: "Open Agent is up to date" });
    expect(check({ appVersion: "0.0.0-dev", checked: true, shell: "99.0.0" })).toMatchObject({ text: "" });
    const row = check({ appVersion: "0.0.0-dev" });
    expect(row && row.kind === "row" ? row.buttons : []).toEqual([
      { key: "check", label: "Check for updates…", action: { type: "checkForUpdates" } },
    ]);
  });
});

describe("screen-services", () => {
  it("holds the About section, Back, and the focus target", () => {
    const m = screenModel({ ...base, focus: "update-row", update: { appVersion: "0.0.0-dev", shell: "99.0.0" } });
    expect(m.id).toBe("screen-services");
    expect(m.title).toBe("Services & data");
    expect(m.focus).toBe("update-row");
    expect(m.blocks.some((b) => b.key === "update-row")).toBe(true);
    expect(m.buttons.map((b) => b.action)).toEqual([{ type: "closeServices" }]);
  });
});

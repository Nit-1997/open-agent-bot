import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { silentLog } from "../src/main/logger.ts";
import { createSettingsStore, DEFAULT_SETTINGS } from "../src/main/settings.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oab-settings-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("settings store (C10)", () => {
  it("get() serves the cache: an outside write is not read back while the app runs", () => {
    const file = join(dir, "settings.json");
    writeFileSync(file, JSON.stringify({ ...DEFAULT_SETTINGS, stopOnQuit: true }));
    const store = createSettingsStore(file, silentLog);
    expect(store.get().stopOnQuit).toBe(true);
    writeFileSync(file, JSON.stringify({ ...DEFAULT_SETTINGS, stopOnQuit: false }));
    expect(store.get().stopOnQuit).toBe(true);
  });

  it("update() writes through and the next get() returns it", () => {
    const file = join(dir, "settings.json");
    const store = createSettingsStore(file, silentLog);
    store.update({ stopOnQuit: false });
    expect(store.get().stopOnQuit).toBe(false);
    expect(JSON.parse(readFileSync(file, "utf8")).stopOnQuit).toBe(false);
  });
});

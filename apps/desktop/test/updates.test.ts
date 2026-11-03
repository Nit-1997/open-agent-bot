import { describe, expect, it } from "vitest";
import { silentLog } from "../src/main/logger.ts";
import type { ServicePins } from "../src/main/services.ts";
import { DEFAULT_SETTINGS, type Settings, type SettingsStore } from "../src/main/settings.ts";
import type { UpdateResult } from "../src/main/updateCheck.ts";
import { createUpdates } from "../src/main/updates.ts";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const PAGE = "https://github.com/Nit-1997/open-agent-bot/releases/tag/v99.0.0";
const NEXT: ServicePins = {
  kind: "dev",
  version: "0.0.0-b",
  composeSha256: "c".repeat(64),
  images: {
    agent: `127.0.0.1:18477/oab-m4-agent@sha256:${"c".repeat(64)}`,
    search: `127.0.0.1:18477/oab-m4-search@sha256:${"d".repeat(64)}`,
  },
  pull: true,
};

function memorySettings(initial: Partial<Settings> = {}): SettingsStore {
  let cur: Settings = { ...DEFAULT_SETTINGS, ...initial };
  return {
    get: () => cur,
    update: (patch, drop = []) => {
      const next: Record<string, unknown> = { ...cur, ...patch };
      for (const k of drop) delete next[k];
      cur = next as Settings;
      return cur;
    },
  };
}

function setup(o: { settings?: Partial<Settings>; results?: UpdateResult[]; configured?: boolean; log?: string[] } = {}) {
  const settings = memorySettings(o.settings);
  const results = [...(o.results ?? [{ ok: true }])];
  let calls = 0;
  const opened: string[] = [];
  let changes = 0;
  const lines = o.log ?? [];
  const u = createUpdates({
    appVersion: "1.4.0",
    settings,
    now: () => NOW,
    log: o.log ? { info: (l) => lines.push(l), warn: (l) => lines.push(l), error: (l) => lines.push(l) } : silentLog,
    onChange: () => {
      changes += 1;
    },
    openExternal: (url) => opened.push(url),
    ...(o.configured === false
      ? {}
      : {
          check: async () => {
            calls += 1;
            return results.length > 1 ? (results.shift() as UpdateResult) : (results[0] as UpdateResult);
          },
        }),
  });
  return { u, settings, opened, calls: () => calls, changes: () => changes };
}

describe("automatic check", () => {
  it("disabled → zero requests and nothing stored", async () => {
    const t = setup({ settings: { checkForUpdates: false } });
    await t.u.auto();
    expect(t.calls()).toBe(0);
    expect(t.settings.get().lastUpdateCheck).toBeUndefined();
  });

  it("at most once per 24 h, recorded in lastUpdateCheck", async () => {
    const recent = setup({ settings: { lastUpdateCheck: new Date(NOW - 3_600_000).toISOString() } });
    await recent.u.auto();
    expect(recent.calls()).toBe(0);
    const old = setup({ settings: { lastUpdateCheck: new Date(NOW - 25 * 3_600_000).toISOString() } });
    await old.u.auto();
    expect(old.calls()).toBe(1);
    expect(old.settings.get().lastUpdateCheck).toBe(new Date(NOW).toISOString());
    await old.u.auto();
    expect(old.calls()).toBe(1);
  });

  it("a failure is only logged: no error in the view", async () => {
    const log: string[] = [];
    const t = setup({ results: [{ ok: false, reason: "offline" }], log });
    await t.u.auto();
    expect(t.u.view()).toEqual({ appVersion: "1.4.0" });
    expect(log).toContain("[update] check failed reason=offline (automatic)");
  });

  it("no releases URL configured → no request", async () => {
    const t = setup({ configured: false });
    await t.u.auto();
    expect(t.settings.get().lastUpdateCheck).toBeUndefined();
  });
});

describe("manual check", () => {
  it("runs even when automatic checks are off and shows a failure reason", async () => {
    const t = setup({ settings: { checkForUpdates: false }, results: [{ ok: false, reason: "rate_limited" }, { ok: true }] });
    await t.u.manual();
    expect(t.calls()).toBe(1);
    expect(t.u.view()).toEqual({ appVersion: "1.4.0", error: "rate_limited", checked: true });
    await t.u.manual();
    expect(t.u.view()).toEqual({ appVersion: "1.4.0", checked: true });
  });

  it("concurrent requests share one check", async () => {
    const t = setup();
    await Promise.all([t.u.manual(), t.u.manual(), t.u.manual()]);
    expect(t.calls()).toBe(1);
  });

  it("not configured → Couldn't check: not_configured", async () => {
    const t = setup({ configured: false });
    await t.u.manual();
    expect(t.u.view().error).toBe("not_configured");
  });

  it("emits a change while checking and after", async () => {
    const t = setup();
    await t.u.manual();
    expect(t.changes()).toBeGreaterThanOrEqual(2);
  });
});

describe("a new app version", () => {
  const found: UpdateResult = { ok: true, shell: { version: "99.0.0", pageUrl: PAGE } };

  it("shows in the view and the menu; Download opens the page", async () => {
    const t = setup({ results: [found] });
    await t.u.auto();
    expect(t.u.view()).toEqual({ appVersion: "1.4.0", shell: "99.0.0" });
    expect(t.u.menuVersion()).toBe("99.0.0");
    expect(t.u.download()).toEqual({ ok: true });
    expect(t.opened).toEqual([PAGE]);
  });

  it("Later stores dismissedVersion and hides the menu item for that version only", async () => {
    const t = setup({ results: [found, { ok: true, shell: { version: "99.0.1", pageUrl: PAGE } }] });
    await t.u.auto();
    expect(t.u.dismiss()).toEqual({ ok: true });
    expect(t.settings.get().dismissedVersion).toBe("99.0.0");
    expect(t.u.menuVersion()).toBeUndefined();
    expect(t.u.view()).toEqual({ appVersion: "1.4.0", shell: "99.0.0", dismissed: true });
    await t.u.manual();
    expect(t.u.menuVersion()).toBe("99.0.1");
    expect(t.u.view().dismissed).toBeUndefined();
  });

  it("a version dismissed earlier stays hidden after a relaunch", async () => {
    const t = setup({ results: [found], settings: { dismissedVersion: "99.0.0" } });
    await t.u.auto();
    expect(t.u.menuVersion()).toBeUndefined();
  });

  it("Download and Later without an update → not_available", () => {
    const t = setup();
    expect(t.u.download()).toEqual({ ok: false, error: "not_available" });
    expect(t.u.dismiss()).toEqual({ ok: false, error: "not_available" });
    expect(t.opened).toEqual([]);
  });
});

describe("a service update", () => {
  it("is pending until accepted", async () => {
    const t = setup({ results: [{ ok: true, services: NEXT }] });
    await t.u.auto();
    expect(t.u.view()).toEqual({ appVersion: "1.4.0", services: "0.0.0-b" });
    expect(t.u.pending()).toEqual(NEXT);
    t.u.accepted(NEXT);
    expect(t.u.pending()).toBeUndefined();
    expect(t.u.view()).toEqual({ appVersion: "1.4.0" });
  });

  it("an incompatible manifest carries its reason and is never pending", async () => {
    const t = setup({ results: [{ ok: true, incompatible: "compose_mismatch" }] });
    await t.u.auto();
    expect(t.u.view()).toEqual({ appVersion: "1.4.0", incompatible: "compose_mismatch" });
    expect(t.u.pending()).toBeUndefined();
  });
});

describe("act routing", () => {
  it("handles the four update actions and leaves the rest", async () => {
    const t = setup({ results: [{ ok: true, shell: { version: "99.0.0", pageUrl: PAGE } }] });
    expect(await t.u.act({ type: "checkForUpdates" })).toEqual({ ok: true });
    expect(await t.u.act({ type: "downloadUpdate" })).toEqual({ ok: true });
    expect(await t.u.act({ type: "dismissUpdate" })).toEqual({ ok: true });
    expect(await t.u.act({ type: "setCheckForUpdates", value: false })).toEqual({ ok: true });
    expect(t.settings.get().checkForUpdates).toBe(false);
    expect(t.u.act({ type: "restartServices" })).toBeUndefined();
  });
});

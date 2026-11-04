import { describe, expect, it } from "vitest";
import type { ShellState } from "../src/shared/actions.ts";
import { filterLogs } from "../src/shared/logsFilter.ts";
import { screenModel } from "../src/shared/screenModel.ts";
import type { ContainerInspect } from "../src/main/compose.ts";
import { serviceInfoRows, serviceStateText } from "../src/main/servicesScreen.ts";

const c = (service: string, o: Partial<ContainerInspect> = {}): ContainerInspect => ({
  id: `${service}-id`,
  service,
  image: "img",
  imageId: "sha256:x",
  status: "running",
  exitCode: 0,
  health: "healthy",
  restartCount: 0,
  version: "0.0.0-m43a",
  ...o,
});

describe("serviceStateText", () => {
  it.each([
    [{ status: "running", health: "healthy" }, "running · healthy"],
    [{ status: "running", health: "starting" }, "running · starting"],
    [{ status: "running", health: "unhealthy" }, "unhealthy"],
    [{ status: "running" }, "running"],
    [{ status: "restarting", exitCode: 82 }, "restarting"],
    [{ status: "exited", exitCode: 137 }, "exited (137)"],
    [{ status: "exited", exitCode: 0 }, "exited (0)"],
    [{ status: "created", exitCode: 0 }, "exited (0)"],
    [{ status: "dead", exitCode: 1 }, "exited (1)"],
    [undefined, "missing"],
  ])("%j → %s", (input, text) => {
    expect(serviceStateText(input as never)).toBe(text);
  });
});

describe("serviceInfoRows", () => {
  it("lists agent, search and renderer in order with the image-label version; a missing container is missing", () => {
    const rows = serviceInfoRows([c("renderer", { status: "exited", exitCode: 143, health: undefined }), c("agent")]);
    expect(rows).toEqual([
      { service: "agent", label: "agent", state: "running · healthy", version: "0.0.0-m43a" },
      { service: "search", label: "search (SearXNG)", state: "missing", version: "—" },
      { service: "renderer", label: "renderer", state: "exited (143)", version: "0.0.0-m43a" },
    ]);
  });
});

const base: ShellState = {
  phase: "ready",
  screen: "screen-services",
  test: true,
  port: 18430,
  servicesVersion: "0.0.0-fake",
  engine: {
    cli: "/usr/local/bin/docker",
    context: "desktop-linux",
    engine: "docker-desktop",
    engineName: "Docker Desktop",
    compose: "5.1.1",
    server: "29.3.1",
    socket: "/Users/x/.docker/run/docker.sock",
    memWarning: false,
  },
  settings: { stopOnQuit: true, checkForUpdates: true },
  servicesInfo: {
    rows: [
      { service: "agent", label: "agent", state: "running · healthy", version: "0.0.0-fake" },
      { service: "search", label: "search (SearXNG)", state: "running · healthy", version: "0.0.0-fake" },
      { service: "renderer", label: "renderer", state: "running", version: "0.0.0-fake" },
    ],
    data: { volume: "oab-x-data", dbBytes: 3 * 1024 * 1024, reports: 2, chats: 5 },
  },
};

const ids = (m: ReturnType<typeof screenModel>) => [...m.blocks.map((b) => b.key), ...m.buttons.map((b) => b.key)];

describe("the Services & data screen model", () => {
  it("has the status table, engine line, toggles, port, data line, export wording and the buttons", () => {
    const m = screenModel(base);
    expect(m.id).toBe("screen-services");
    expect(m.title).toBe("Services & data");
    const table = m.blocks.find((b) => b.kind === "table");
    expect(table && table.kind === "table" ? table.rows.map((r) => r.cells) : []).toEqual([
      { service: "agent", state: "running · healthy", version: "0.0.0-fake" },
      { service: "search (SearXNG)", state: "running · healthy", version: "0.0.0-fake" },
      { service: "renderer", state: "running", version: "0.0.0-fake" },
    ]);
    const text = JSON.stringify(m);
    expect(text).toContain("/usr/local/bin/docker");
    expect(text).toContain("desktop-linux");
    expect(text).toContain("Docker Desktop");
    expect(text).toContain("5.1.1");
    expect(text).toContain("oab-x-data");
    expect(text).toContain("3 MB");
    expect(text).toContain("Telemetry: none");
    expect(text).toContain("Saved model keys are not included. Chats, reports and your profile are.");
    expect(m.blocks.find((b) => b.kind === "toggle")).toMatchObject({ setting: "stopOnQuit", checked: true });
    expect(m.blocks.find((b) => b.kind === "port")).toMatchObject({ value: 18430 });
    expect(ids(m)).toEqual(expect.arrayContaining(["restart", "update", "logs", "export", "delete", "close"]));
    expect(m.buttons.find((b) => b.key === "restart")?.confirm).toBe("Chats in progress will stop.");
    expect(m.buttons.find((b) => b.key === "update")).toMatchObject({ label: "Up to date (0.0.0-fake)", disabled: true });
    expect(m.buttons.find((b) => b.key === "export")?.action).toEqual({ type: "exportData" });
    expect(m.buttons.find((b) => b.key === "delete")?.action).toEqual({ type: "confirmDelete" });
    expect(new Set(ids(m)).size).toBe(ids(m).length);
  });

  it("a local build reads 'Not available for local builds' and shows the badge", () => {
    const m = screenModel({ ...base, localBuild: "Local build (local-abc1234)" });
    expect(m.badge).toBe("Local build (local-abc1234)");
    expect(m.buttons.find((b) => b.key === "update")).toMatchObject({ label: "Not available for local builds", disabled: true });
  });

  it("no stats yet → 'Reading…'; a stats failure is shown, never hidden", () => {
    expect(JSON.stringify(screenModel({ ...base, servicesInfo: { rows: [] } }))).toContain("Reading…");
    expect(JSON.stringify(screenModel({ ...base, servicesInfo: { rows: [], dataProblem: "stats failed (exit 1)" } }))).toContain(
      "stats failed (exit 1)",
    );
  });

  it("a notice is shown on any screen", () => {
    const notice = { tone: "info" as const, text: "Exported to /tmp/x.zip (1 MB). Saved model keys are not included." };
    for (const screen of ["screen-services", "screen-refusal-db_newer", "screen-confirm-delete", "screen-logs"]) {
      const m = screenModel({ ...base, screen, refusal: { code: "db_newer", line: "x", exitCode: 80 }, notice });
      expect(m.blocks.find((b) => b.key === "notice")).toMatchObject({ kind: "p", text: notice.text });
    }
  });
});

describe("refusal screens offer Export data (D15)", () => {
  const refusal = (code: string) =>
    screenModel({ ...base, screen: `screen-refusal-${code}`, refusal: { code, line: `[startup] refused code=${code} x`, exitCode: 80 } });
  it.each(["config", "db_newer", "db_migration", "kek_missing", "keyfile_invalid", "ui_missing", "identity"])(
    "%s has Export data",
    (code) => {
      expect(refusal(code).buttons.find((b) => b.key === "export")?.action).toEqual({ type: "exportData" });
    },
  );
  it("db_corrupt has no export and says why", () => {
    const m = refusal("db_corrupt");
    expect(m.buttons.find((b) => b.key === "export")).toBeUndefined();
    expect(JSON.stringify(m)).toContain("Export isn't available for a damaged database in this version");
  });
  it("listen has no export", () => {
    expect(refusal("listen").buttons.find((b) => b.key === "export")).toBeUndefined();
  });
});

describe("confirm delete offers Export first", () => {
  it("has an Export button before the typed confirm", () => {
    const m = screenModel({ ...base, screen: "screen-confirm-delete", confirm: { dataVolume: "d", keysVolume: "k" } });
    expect(m.buttons.map((b) => b.key)).toEqual(["export", "confirm", "cancel"]);
    expect(JSON.stringify(m)).toContain("Saved model keys are not included");
  });
});

describe("the logs screen", () => {
  it("has the logs block with Refresh, Save logs and Back", () => {
    const m = screenModel({ ...base, screen: "screen-logs", logs: { text: "agent-1  | [http] GET /api/chats 200" } });
    expect(m.blocks.find((b) => b.kind === "logs")).toMatchObject({ key: "text" });
    expect(m.buttons.map((b) => b.key)).toEqual(["refresh", "save", "back"]);
    expect(m.buttons.find((b) => b.key === "save")?.action).toEqual({ type: "saveLogs" });
  });
});

describe("filterLogs", () => {
  const text = [
    "agent-1  | 2026-11-03T10:00:00Z [local] listening on 0.0.0.0:3000",
    "agent-1  | 2026-11-03T10:00:01Z [http] GET /health 200 2ms",
    "search-1  | 2026-11-03T10:00:01Z searx ready",
    "renderer-1  | 2026-11-03T10:00:02Z [http] POST /render 200 90ms",
    "",
  ].join("\n");
  it("all services, all lines", () => {
    expect(filterLogs(text, { service: "all", requestsOnly: false }).split("\n")).toHaveLength(4);
  });
  it("requests only keeps [http] lines", () => {
    expect(filterLogs(text, { service: "all", requestsOnly: true }).split("\n")).toEqual([
      "agent-1  | 2026-11-03T10:00:01Z [http] GET /health 200 2ms",
      "renderer-1  | 2026-11-03T10:00:02Z [http] POST /render 200 90ms",
    ]);
  });
  it("a service selector keeps that service's lines", () => {
    expect(filterLogs(text, { service: "search", requestsOnly: false })).toBe("search-1  | 2026-11-03T10:00:01Z searx ready");
    expect(filterLogs(text, { service: "agent", requestsOnly: true })).toBe("agent-1  | 2026-11-03T10:00:01Z [http] GET /health 200 2ms");
  });
  it("nothing matching → an explicit empty marker", () => {
    expect(filterLogs(text, { service: "search", requestsOnly: true })).toBe("(no matching lines)");
  });
});

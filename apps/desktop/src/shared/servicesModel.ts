import { aboutBlocks } from "./aboutModel.ts";
import type { ShellState } from "./actions.ts";
import type { Block, Button, ScreenModel } from "./screenModel.ts";
import { EXPORT_WORDING, PORT_WARNING, RESTART_WARNING } from "./wording.ts";
import { formatBytes } from "./util.ts";

export function updateButton(s: ShellState): Button {
  const action = { type: "updateServices" } as const;
  if (s.localBuild) return { key: "update", label: "Not available for local builds", action, disabled: true };
  const next = s.update?.services;
  if (next) return { key: "update", label: `Update services (${next} available)`, action, tone: "primary" };
  return { key: "update", label: `Up to date (${s.servicesVersion ?? "unknown"})`, action, disabled: true };
}

function dataBlock(s: ShellState): Block {
  const info = s.servicesInfo;
  if (info?.data)
    return {
      kind: "rows",
      key: "data",
      rows: [
        { key: "volume", label: "Data volume", value: info.data.volume },
        { key: "size", label: "Database", value: formatBytes(info.data.dbBytes) },
        { key: "reports", label: "Reports", value: String(info.data.reports) },
        { key: "chats", label: "Chats", value: String(info.data.chats) },
      ],
    };
  if (info?.dataProblem) return { kind: "p", key: "data", tone: "warn", text: `Data: ${info.dataProblem}` };
  return { kind: "p", key: "data", tone: "muted", text: "Data: Reading…" };
}

export function servicesModel(s: ShellState): ScreenModel {
  const e = s.engine;
  const blocks: Block[] = [
    {
      kind: "table",
      key: "services",
      columns: [
        { key: "service", label: "Service" },
        { key: "state", label: "Status" },
        { key: "version", label: "Version" },
      ],
      rows: (s.servicesInfo?.rows ?? []).map((r) => ({ key: r.service, cells: { service: r.label, state: r.state, version: r.version } })),
    },
    {
      kind: "rows",
      key: "engine",
      rows: [
        { key: "cli", label: "Docker CLI", value: e?.cli ?? "unknown" },
        { key: "context", label: "Context", value: e?.context ?? "unknown" },
        { key: "engine", label: "Engine", value: e?.engineName ?? "unknown" },
        { key: "compose", label: "Compose", value: e?.compose ?? "unknown" },
        ...(e?.socket ? [{ key: "socket", label: "Socket", value: `${e.socket} (owned by you)` }] : []),
      ],
    },
    {
      kind: "toggle",
      key: "stop-on-quit",
      label: "Stop services when I quit Open Agent",
      checked: s.settings?.stopOnQuit ?? true,
      setting: "stopOnQuit",
    },
    {
      kind: "toggle",
      key: "check-for-updates",
      label: "Check for new versions",
      checked: s.settings?.checkForUpdates ?? true,
      setting: "checkForUpdates",
    },
    { kind: "port", key: "port", label: "Port", ...(s.port !== undefined ? { value: s.port } : {}), warning: PORT_WARNING },
    dataBlock(s),
    { kind: "p", key: "telemetry", tone: "muted", text: "Telemetry: none" },
    { kind: "p", key: "export-note", tone: "muted", text: `Export chats & reports (.zip). ${EXPORT_WORDING}` },
    ...aboutBlocks(s),
  ];
  const buttons: Button[] = [
    { key: "restart", label: "Restart services", action: { type: "restartServices" }, tone: "primary", confirm: RESTART_WARNING },
    updateButton(s),
    { key: "logs", label: "View logs", action: { type: "showLogs" } },
    { key: "export", label: "Export chats & reports (.zip)", action: { type: "exportData" } },
    { key: "delete", label: "Delete all data…", action: { type: "confirmDelete" }, tone: "danger" },
    { key: "close", label: "Close", action: { type: "closeServices" } },
  ];
  return {
    id: "screen-services",
    title: "Services & data",
    ...(s.localBuild ? { badge: s.localBuild } : {}),
    blocks,
    buttons,
    ...(s.focus ? { focus: s.focus } : {}),
  };
}

import type { PullRow, ShellAction, ShellState } from "./actions.ts";
import { servicesModel } from "./servicesModel.ts";
import { EXPORT_WORDING } from "./wording.ts";

export type StepState = "pending" | "active" | "done" | "failed";
export type Step = Readonly<{
  key: string;
  label: string;
  detail: string;
  state: StepState;
  bar?: Readonly<{ value: number; max: number }>;
}>;
export type Block =
  | Readonly<{ kind: "p"; key: string; text: string; tone?: "muted" | "warn" }>
  | Readonly<{ kind: "pre"; key: string; text: string }>
  | Readonly<{ kind: "list"; key: string; items: readonly Readonly<{ key: string; text: string }>[] }>
  | Readonly<{ kind: "steps"; key: string; steps: readonly Step[] }>
  | Readonly<{ kind: "rows"; key: string; rows: readonly Readonly<{ key: string; label: string; value: string }>[] }>
  | Readonly<{ kind: "input"; key: string; label: string; expect: string }>
  | Readonly<{
      kind: "table";
      key: string;
      columns: readonly Readonly<{ key: string; label: string }>[];
      rows: readonly Readonly<{ key: string; cells: Readonly<Record<string, string>> }>[];
    }>
  | Readonly<{ kind: "toggle"; key: string; label: string; checked: boolean; setting: "stopOnQuit" | "checkForUpdates" }>
  | Readonly<{ kind: "port"; key: string; label: string; value?: number; warning: string }>
  | Readonly<{ kind: "logs"; key: string; text: string }>
  | Readonly<{ kind: "row"; key: string; id?: string; text: string; buttons: readonly Button[] }>;
export type Button = Readonly<{
  key: string;
  label: string;
  action: ShellAction;
  tone?: "primary" | "danger";
  needsInput?: string;
  disabled?: boolean;
  confirm?: string;
}>;
export type ScreenModel = Readonly<{
  id: string;
  title: string;
  badge?: string;
  blocks: readonly Block[];
  buttons: readonly Button[];
  focus?: string;
}>;

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const size = (n: number) => (n >= GB ? `${(n / GB).toFixed(1)} GB` : `${Math.max(0, Math.round(n / MB))} MB`);

export function pullDetail(rows: readonly PullRow[]): { detail: string; value: number; max: number } {
  const names = rows.map((r) => r.name).join(", ");
  const started = rows.filter((r) => r.layersTotal > 0 || r.bytesTotal !== undefined);
  const layersDone = rows.reduce((a, r) => a + r.layersDone, 0);
  const layersTotal = rows.reduce((a, r) => a + r.layersTotal, 0);
  const layers = `layer ${layersDone} of ${layersTotal}`;
  if (started.length > 0 && started.every((r) => r.bytesTotal !== undefined)) {
    const done = started.reduce((a, r) => a + (r.bytesDone ?? 0), 0);
    const total = started.reduce((a, r) => a + (r.bytesTotal ?? 0), 0);
    return { detail: `${names} · ${size(done)} of ${size(total)} · ${layers}`, value: done, max: Math.max(total, 1) };
  }
  return { detail: `${names} · ${layers}`, value: layersDone, max: Math.max(layersTotal, 1) };
}

const PHASE_STEP: Readonly<Record<string, number>> = {
  checkingDocker: 0,
  inspecting: 1,
  portCheck: 1,
  pulling: 1,
  creating: 2,
  resetting: 2,
  waitingHealth: 2,
  attaching: 2,
  resuming: 2,
  ready: 3,
};

const btn = (key: string, label: string, action: ShellAction, tone?: Button["tone"]): Button => ({
  key,
  label,
  action,
  ...(tone ? { tone } : {}),
});
const LOGS = btn("logs", "View logs", { type: "showLogs" });
const RESTART = btn("restart", "Restart services", { type: "restartServices" }, "primary");
const QUIT = btn("quit", "Quit", { type: "quit" });
const RETRY = btn("retry", "Retry", { type: "retry" }, "primary");
const DELETE = btn("delete", "Delete all data…", { type: "confirmDelete" }, "danger");
const EXPORT = btn("export", "Export data", { type: "exportData" });
const STARTUP_ERRORS = btn("startup-errors", "Startup errors", { type: "openLink", link: "startup-errors" });

function progressModel(s: ShellState): ScreenModel {
  const at = PHASE_STEP[s.phase] ?? 0;
  const state = (i: number): StepState => (i < at ? "done" : i === at ? "active" : "pending");
  const e = s.engine;
  const pull = s.pull && s.pull.length > 0 ? pullDetail(s.pull) : undefined;
  const services = (s.services ?? []).map((r) => `${r.service} ${r.health || r.state}`).join(" · ");
  const steps: Step[] = [
    { key: "docker", label: "Docker", detail: e ? `${e.engineName} is running` : "Checking Docker", state: state(0) },
    {
      key: "download",
      label: "Downloading services",
      detail: pull ? pull.detail : at > 1 ? "agent, search, renderer · ready" : "agent, search, renderer",
      state: state(1),
      ...(pull ? { bar: { value: pull.value, max: pull.max } } : {}),
    },
    {
      key: "start",
      label: "Starting",
      detail: services || (s.phase === "resuming" ? "starting your services" : "waiting for the agent to report healthy"),
      state: state(2),
    },
  ];
  const blocks: Block[] = [{ kind: "steps", key: "steps", steps }];
  if (e?.memWarning)
    blocks.push({
      kind: "p",
      key: "memory",
      tone: "warn",
      text: `Docker has ${size(e.memBytes ?? 0)} of memory; Open Agent works best with 4 GB or more.`,
    });
  return {
    id: "screen-progress",
    title: "Getting your agent ready",
    ...(s.localBuild ? { badge: s.localBuild } : {}),
    blocks,
    buttons: s.phase === "pulling" ? [btn("cancel", "Cancel", { type: "cancelPull" })] : [],
  };
}

const REFUSAL_TEXT: Readonly<Record<string, string>> = {
  config: "Open Agent couldn't start its services: invalid settings",
  db_corrupt: "Your database is damaged",
  db_newer: "Your data was saved by a newer Open Agent",
  db_migration: "Updating your data failed. A backup was kept.",
  kek_missing: "Your saved model keys can't be unlocked",
  keyfile_invalid: "A key file has the wrong permissions or content",
  ui_missing: "The service image is broken",
  identity: "The service image is broken",
  listen: "The agent couldn't listen",
};

function refusalModel(s: ShellState): ScreenModel {
  const r = s.refusal ?? { code: "config", line: "", exitCode: 0 };
  const id = `screen-refusal-${r.code}`;
  const blocks: Block[] = [{ kind: "pre", key: "line", text: r.line }];
  let buttons: Button[];
  switch (r.code) {
    case "config":
      buttons = [RESTART, LOGS, STARTUP_ERRORS, EXPORT];
      break;
    case "db_corrupt":
      blocks.push({
        kind: "p",
        key: "no-export",
        tone: "muted",
        text: "Export isn't available for a damaged database in this version; your data volume is kept until you delete it.",
      });
      buttons = [DELETE, LOGS];
      break;
    case "db_newer":
      buttons = [btn("latest", "Get the latest version", { type: "openLink", link: "release-page" }, "primary"), EXPORT];
      break;
    case "db_migration":
      buttons = [RESTART, EXPORT, LOGS];
      break;
    case "kek_missing":
      blocks.unshift({
        kind: "p",
        key: "count",
        text: `${r.count ?? "Some"} saved model key${r.count === 1 ? "" : "s"} can't be unlocked because the key file is gone.`,
      });
      buttons = [btn("reset", "Reset saved model keys…", { type: "confirmReset" }, "danger"), EXPORT, LOGS];
      break;
    case "keyfile_invalid":
      buttons = [LOGS, STARTUP_ERRORS, EXPORT, DELETE];
      break;
    case "ui_missing":
    case "identity":
      buttons = [btn("update", "Re-download services", { type: "updateServices" }, "primary"), EXPORT, LOGS];
      break;
    case "listen":
      buttons = [btn("pick-port", "Pick another port", { type: "pickAnotherPort" }, "primary"), LOGS];
      break;
    default:
      buttons = [LOGS];
  }
  return { id, title: REFUSAL_TEXT[r.code] ?? "Open Agent couldn't start its services", blocks, buttons: [...buttons, QUIT] };
}

const FAILURE_TEXT: Readonly<Record<string, string>> = {
  cancelled: "Download stopped",
  pull_failed: "Downloading the services failed",
  up_failed: "Open Agent's services didn't start",
  health_timeout: "The agent didn't report healthy in time",
  refusal_mismatch: "The agent stopped with an unexpected refusal",
  crashed: "The agent stopped unexpectedly",
  port_mismatch: "The services are published on an unexpected address",
  launch_mismatch: "The services were started with a different key",
  ui_crashed: "The Open Agent window crashed",
  internal_error: "Something went wrong inside Open Agent",
  local_images_changed: "The images this build was made with are gone or were rebuilt",
  pending_delete_mismatch: "An unfinished delete doesn't match these services",
  pins_invalid: "This build's service pins are invalid",
  ports_exhausted: "No free port for the services",
  inspect_failed: "Docker didn't answer",
  not_linux: "This Docker engine can't run Linux containers",
  delete_failed: "Deleting your data failed",
  export_invalid: "The export didn't pass its checks and was deleted",
};

function failureModel(s: ShellState): ScreenModel {
  const f = s.failure ?? { reason: "unknown" };
  const blocks: Block[] = [
    {
      kind: "p",
      key: "reason",
      tone: "muted",
      text: `Reason: ${f.reason}${f.step ? ` (step ${f.step})` : ""}${f.exitCode !== undefined ? `, exit code ${f.exitCode}` : ""}`,
    },
  ];
  if (f.detail) blocks.push({ kind: "p", key: "detail", text: f.detail });
  if (f.tail) blocks.push({ kind: "pre", key: "tail", text: f.tail });
  let buttons: Button[];
  switch (f.reason) {
    case "launch_mismatch":
      buttons = [RESTART];
      break;
    case "ui_crashed":
      buttons = [btn("reload", "Reload", { type: "retry" }, "primary")];
      break;
    case "internal_error":
      buttons = [btn("relaunch", "Restart Open Agent", { type: "relaunch" }, "primary")];
      break;
    case "pending_delete_mismatch": {
      const p = s.pendingDelete;
      if (p)
        blocks.push({
          kind: "rows",
          key: "names",
          rows: [
            { key: "stored", label: "Unfinished delete", value: `${p.stored.project} · ${p.stored.dataVolume} · ${p.stored.keysVolume}` },
            { key: "current", label: "These services", value: `${p.current.project} · ${p.current.dataVolume} · ${p.current.keysVolume}` },
          ],
        });
      blocks.push({ kind: "p", key: "nothing", tone: "muted", text: "Nothing was deleted." });
      buttons = [btn("discard", "Discard", { type: "discardPendingDelete" }, "primary")];
      break;
    }
    case "crashed":
    case "health_timeout":
    case "refusal_mismatch":
    case "up_failed":
    case "port_mismatch":
      buttons = [RESTART, LOGS];
      break;
    default:
      buttons = [RETRY];
  }
  return { id: "screen-failed", title: FAILURE_TEXT[f.reason] ?? "Open Agent couldn't start", blocks, buttons: [...buttons, QUIT] };
}

const SEARCHED_NOTE = "Docker Desktop is free for personal use and small businesses; OrbStack and Colima are alternatives.";

export function screenModel(s: ShellState): ScreenModel {
  const m = baseModel(s);
  if (!s.notice) return m;
  const notice: Block = { kind: "p", key: "notice", text: s.notice.text, ...(s.notice.tone === "error" ? { tone: "warn" as const } : {}) };
  return { ...m, blocks: [...m.blocks, notice] };
}

function baseModel(s: ShellState): ScreenModel {
  switch (s.screen) {
    case "app":
    case "screen-progress":
      return progressModel(s);
    case "screen-docker-missing":
      return {
        id: s.screen,
        title: "Open Agent needs Docker",
        blocks: [
          { kind: "p", key: "intro", text: "Install one of these, then press Retry." },
          { kind: "p", key: "note", tone: "muted", text: SEARCHED_NOTE },
          { kind: "list", key: "searched", items: (s.docker?.searched ?? []).map((p, i) => ({ key: String(i), text: `Searched ${p}` })) },
          {
            kind: "list",
            key: "rejected",
            items: (s.docker?.rejected ?? []).map((r, i) => ({ key: String(i), text: `Skipped ${r.reason}` })),
          },
        ],
        buttons: [
          btn("get-docker-desktop", "Get Docker Desktop", { type: "openLink", link: "get-docker-desktop" }, "primary"),
          btn("get-orbstack", "Get OrbStack", { type: "openLink", link: "get-orbstack" }),
          btn("get-colima", "Get Colima", { type: "openLink", link: "get-colima" }),
          RETRY,
          QUIT,
        ],
      };
    case "screen-docker-stopped":
    case "screen-services-stopped": {
      if (s.screen === "screen-services-stopped" && s.stopped?.reason !== "docker_stopped") {
        const st = s.stopped;
        return {
          id: s.screen,
          title: "Open Agent's services stopped",
          blocks: [
            {
              kind: "p",
              key: "reason",
              tone: "muted",
              text: `Reason: ${st?.reason ?? "unknown"}${st?.exitCode !== undefined ? `, exit code ${st.exitCode}` : ""}`,
            },
            ...(st?.tail ? [{ kind: "pre" as const, key: "tail", text: st.tail }] : []),
          ],
          buttons: [RESTART, LOGS, QUIT],
        };
      }
      const apps = s.apps;
      return {
        id: s.screen,
        title: s.screen === "screen-docker-stopped" ? "Docker isn't running" : "Docker stopped",
        blocks: [
          { kind: "p", key: "intro", text: "Start Docker. Open Agent continues by itself when Docker is running." },
          ...(apps?.colima ? [{ kind: "p" as const, key: "colima", text: "Colima: run colima start in a terminal." }] : []),
        ],
        buttons: [
          ...(apps?.dockerDesktop
            ? [btn("open-docker-desktop", "Open Docker Desktop", { type: "openDockerApp", app: "docker-desktop" }, "primary")]
            : []),
          ...(apps?.orbstack ? [btn("open-orbstack", "Open OrbStack", { type: "openDockerApp", app: "orbstack" })] : []),
          btn("get-docker-desktop", "Get Docker Desktop", { type: "openLink", link: "get-docker-desktop" }),
          RETRY,
        ],
      };
    }
    case "screen-compose-old":
      return {
        id: s.screen,
        title: "Docker Compose is too old",
        blocks: [
          {
            kind: "p",
            key: "found",
            text: `Open Agent needs Docker Compose 2.24 or newer${s.compose?.version ? `; this Mac has ${s.compose.version}` : ""}.`,
          },
          { kind: "p", key: "how", tone: "muted", text: "Update Docker Desktop / OrbStack, or brew upgrade docker-compose for Colima." },
        ],
        buttons: [RETRY, QUIT],
      };
    case "screen-docker-remote":
      return {
        id: s.screen,
        title: "Open Agent only runs its services on a Docker engine on this Mac that belongs to you",
        blocks: [
          {
            kind: "rows",
            key: "endpoint",
            rows: [
              { key: "endpoint", label: "Endpoint", value: s.remote?.endpoint ?? "(unknown)" },
              { key: "reason", label: "Problem", value: s.remote?.reason ?? "unknown" },
              ...(s.remote?.owner !== undefined ? [{ key: "owner", label: "Socket owner uid", value: String(s.remote.owner) }] : []),
            ],
          },
          {
            kind: "p",
            key: "how",
            tone: "muted",
            text: "Switch to a local Docker context (docker context use desktop-linux, orbstack or colima), then press Retry.",
          },
        ],
        buttons: [RETRY, QUIT],
      };
    case "screen-no-pins":
      return {
        id: s.screen,
        title: "This build has no pinned service images",
        blocks: [{ kind: "p", key: "how", text: "This build has no pinned service images; download a release build." }],
        buttons: [btn("release", "Download a release", { type: "openLink", link: "release-page" }, "primary"), QUIT],
      };
    case "screen-port-conflict":
      return {
        id: s.screen,
        title: `Port ${s.conflict?.port ?? ""} is taken`,
        blocks: [
          {
            kind: "p",
            key: "what",
            text: `Another program on this Mac uses 127.0.0.1:${s.conflict?.port ?? ""}, where Open Agent's services run.`,
          },
        ],
        buttons: [btn("pick", "Pick another port", { type: "pickAnotherPort" }, "primary"), QUIT],
      };
    case "screen-foreign-stack": {
      const f = s.foreign;
      const sameVolumes = f?.dataVolume === f?.ourDataVolume && f?.keysVolume === f?.ourKeysVolume;
      return {
        id: s.screen,
        title: "Open Agent's services were started elsewhere",
        blocks: [
          {
            kind: "rows",
            key: "details",
            rows: [
              { key: "dir", label: "Started from", value: f?.workingDir ?? "(unknown)" },
              { key: "version", label: "Version", value: f?.version ?? "unknown" },
              { key: "port", label: "Port", value: f?.port !== undefined ? String(f.port) : "none" },
              { key: "volumes", label: "Its data", value: `${f?.dataVolume ?? "?"} · ${f?.keysVolume ?? "?"}` },
              { key: "ours", label: "Open Agent's data", value: `${f?.ourDataVolume ?? "?"} · ${f?.ourKeysVolume ?? "?"}` },
            ],
          },
          {
            kind: "p",
            key: "confirm",
            text: sameVolumes
              ? `This stops the copy started from ${f?.workingDir ?? "?"} and starts Open Agent's own. Your chats and reports are kept (same volumes).`
              : `This stops the copy started from ${f?.workingDir ?? "?"} and starts Open Agent's own. The other copy's data stays in ${f?.dataVolume ?? "?"} and is not used.`,
          },
        ],
        buttons: [btn("use", "Use the app's services", { type: "useAppStack" }, "primary"), QUIT],
      };
    }
    case "screen-confirm-reset":
      return {
        id: s.screen,
        title: "Reset saved model keys?",
        blocks: [
          {
            kind: "p",
            key: "what",
            text: `This deletes ${s.confirm?.count ?? "the"} saved model key${s.confirm?.count === 1 ? "" : "s"}. Chats, reports and your profile stay. You'll add your keys again in Models.`,
          },
          { kind: "input", key: "type", label: "Type reset to confirm", expect: "reset" },
        ],
        buttons: [
          { ...btn("confirm", "Reset saved model keys", { type: "resetCredentials", confirm: "reset" }, "danger"), needsInput: "reset" },
          btn("cancel", "Cancel", { type: "back" }),
        ],
      };
    case "screen-confirm-delete":
      return {
        id: s.screen,
        title: "Delete all data?",
        blocks: [
          {
            kind: "p",
            key: "what",
            text: `This permanently deletes all chats, reports, your profile and saved model keys (volumes ${s.confirm?.dataVolume ?? "?"}, ${s.confirm?.keysVolume ?? "?"}).`,
          },
          s.confirm?.noExport
            ? {
                kind: "p",
                key: "export-note",
                tone: "muted",
                text: "Export isn't available for a damaged database in this version.",
              }
            : {
                kind: "p",
                key: "export-note",
                tone: "muted",
                text: `Export your chats and reports first if you want to keep them. ${EXPORT_WORDING}`,
              },
          { kind: "input", key: "type", label: "Type delete to confirm", expect: "delete" },
        ],
        buttons: [
          ...(s.confirm?.noExport ? [] : [btn("export", "Export first (.zip)", { type: "exportData" })]),
          { ...btn("confirm", "Delete all data", { type: "deleteData", confirm: "delete" }, "danger"), needsInput: "delete" },
          btn("cancel", "Cancel", { type: "back" }),
        ],
      };
    case "screen-failed":
      return failureModel(s);
    case "screen-stopping":
      return {
        id: s.screen,
        title: s.stopping?.what ?? "Stopping…",
        blocks: [{ kind: "p", key: "wait", tone: "muted", text: "This takes a few seconds." }],
        buttons: [],
      };
    case "screen-disk-full": {
      const disk = s.disk;
      const blocks: Block[] =
        disk?.where === "mac"
          ? [{ kind: "p", key: "mac", text: disk.detail ?? "The target folder doesn't have enough free space." }]
          : [
              {
                kind: "p",
                key: "engine",
                text: `${disk?.engine ?? "Docker"} keeps images and data in a virtual disk with its own size limit, separate from the Mac's free space.`,
              },
              { kind: "p", key: "line", text: disk?.line ?? "" },
              { kind: "p", key: "prune", tone: "muted", text: "Remove unused images: docker image prune" },
              ...(disk?.detail ? [{ kind: "pre" as const, key: "detail", text: disk.detail }] : []),
            ];
      const openEngine =
        disk?.engine === "Docker Desktop" && s.apps?.dockerDesktop
          ? [btn("open-engine", "Open Docker Desktop", { type: "openDockerApp", app: "docker-desktop" })]
          : disk?.engine === "OrbStack" && s.apps?.orbstack
            ? [btn("open-engine", "Open OrbStack", { type: "openDockerApp", app: "orbstack" })]
            : [];
      return {
        id: s.screen,
        title: disk?.where === "mac" ? "Not enough free space on this Mac" : "Docker's disk is full",
        blocks,
        buttons: [RETRY, LOGS, ...openEngine],
      };
    }
    case "screen-move-to-applications":
      return {
        id: s.screen,
        title: "Open Agent works best from your Applications folder",
        blocks: [{ kind: "p", key: "why", tone: "muted", text: "Moving it keeps updates and your services in one place." }],
        buttons: [
          btn("move", "Move to Applications", { type: "moveToApplications" }, "primary"),
          btn("keep", "Keep it here", { type: "keepHere" }),
        ],
      };
    case "screen-services":
      return servicesModel(s);
    case "screen-logs":
      return {
        id: s.screen,
        title: "Service logs",
        blocks: [{ kind: "logs", key: "text", text: s.logs?.text ?? "" }],
        buttons: [
          btn("refresh", "Refresh", { type: "showLogs" }),
          btn("save", "Save logs…", { type: "saveLogs" }),
          btn("back", "Back", { type: "back" }, "primary"),
        ],
      };
    default:
      if (s.screen.startsWith("screen-refusal-")) return refusalModel(s);
      return { id: "screen-failed", title: "Open Agent couldn't start", blocks: [], buttons: [RETRY, QUIT] };
  }
}

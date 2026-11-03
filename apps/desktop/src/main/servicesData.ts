import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Notice, ServiceInfoRow, ServicesInfo } from "../shared/actions.ts";
import { EXPORT_WORDING } from "../shared/wording.ts";
import { type Compose, SERVICES } from "./compose.ts";
import { isDiskFull } from "./diskFull.ts";
import type { DockerCli } from "./dockerCli.ts";
import { exportData, readStats } from "./exporter.ts";
import type { Log } from "./logger.ts";
import { serviceInfoRows } from "./servicesScreen.ts";
import type { SettingsStore } from "./settings.ts";
import type { ShellPaths } from "./statePaths.ts";
import { formatBytes } from "../shared/util.ts";

export type SavePath = (o: { defaultName: string; message: string }) => Promise<string | undefined>;

export type DataOutcome =
  | { kind: "notice"; notice: Notice }
  | { kind: "failed"; reason: string; detail?: string }
  | { kind: "disk"; where: "docker" | "mac"; detail?: string }
  | { kind: "cancelled" };

export type DataDeps = Readonly<{
  paths: ShellPaths;
  dataVolume: string;
  project: string;
  log: Log;
  settings: SettingsStore;
  savePath: SavePath;
  freeBytes: (dir: string) => number;
  docker: () => { cli: DockerCli; env: Record<string, string>; agentRef: string } | undefined;
  compose: () => Compose;
  redact: (text: string) => string;
}>;

const pad = (n: number) => String(n).padStart(2, "0");
export const stamp = (d = new Date()) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;

export function createServicesData(d: DataDeps) {
  const trackPartial = (path: string, on: boolean) => {
    const current = d.settings.get().partials ?? [];
    const next = on ? [...new Set([...current, path])] : current.filter((p) => p !== path);
    if (next.length > 0) d.settings.update({ partials: next });
    else if (d.settings.get().partials) d.settings.update({}, ["partials"]);
  };

  const shellLogs = () => {
    const base = join(d.paths.logsDir, "shell.log");
    return [3, 2, 1]
      .map((i) => `${base}.${i}`)
      .concat(base)
      .filter((p) => existsSync(p))
      .map((p) => d.redact(readFileSync(p, "utf8")))
      .join("");
  };

  return {
    async rows(): Promise<ServiceInfoRow[] | undefined> {
      const c = d.compose();
      const ps = await c.ps();
      if (!ps) return undefined;
      return serviceInfoRows(await c.inspect(ps.map((r) => r.id).filter(Boolean)));
    },

    async stats(): Promise<Pick<ServicesInfo, "data" | "dataProblem">> {
      const docker = d.docker();
      if (!docker) return { dataProblem: "Docker isn't ready" };
      const st = await readStats({
        cli: docker.cli,
        env: docker.env,
        dataVolume: d.dataVolume,
        agentRef: docker.agentRef,
        namePrefix: `${d.project}-export`,
      });
      if (!st) return { dataProblem: "the data stats couldn't be read (see View logs)" };
      return { data: { volume: d.dataVolume, dbBytes: st.dbBytes, reports: st.reports, chats: st.chats } };
    },

    async exportZip(signal: AbortSignal): Promise<DataOutcome> {
      const docker = d.docker();
      if (!docker) return { kind: "failed", reason: "export_failed", detail: "Docker isn't ready" };
      const target = await d.savePath({ defaultName: `Open-Agent-export-${stamp()}.zip`, message: EXPORT_WORDING });
      if (!target) return { kind: "cancelled" };
      let partial: string | undefined;
      const r = await exportData({
        cli: docker.cli,
        env: docker.env,
        dataVolume: d.dataVolume,
        agentRef: docker.agentRef,
        namePrefix: `${d.project}-export`,
        target,
        workDir: join(d.paths.stateDir, "tmp"),
        signal,
        freeBytes: d.freeBytes,
        onPartial: (p) => {
          partial = p;
          trackPartial(p, true);
        },
      }).finally(() => {
        if (partial) trackPartial(partial, false);
      });
      if (r.ok) {
        d.log.info(`[export] done entries=${r.entries} bytes=${r.bytes}`);
        return { kind: "notice", notice: { tone: "info", text: `Exported to ${target} (${formatBytes(r.bytes)}). ${EXPORT_WORDING}` } };
      }
      d.log.warn(`[export] ${r.reason}${r.detail ? ` ${d.redact(r.detail)}` : ""}`);
      if (r.reason === "cancelled") return { kind: "cancelled" };
      if (r.reason === "disk_full") return { kind: "disk", where: r.where ?? "docker", ...(r.detail ? { detail: r.detail } : {}) };
      if (r.reason === "export_invalid") return { kind: "failed", reason: "export_invalid", ...(r.detail ? { detail: r.detail } : {}) };
      return { kind: "notice", notice: { tone: "error", text: `The export failed: ${d.redact(r.detail ?? "unknown error")}` } };
    },

    async saveLogs(): Promise<DataOutcome> {
      const target = await d.savePath({
        defaultName: `Open-Agent-logs-${stamp()}.txt`,
        message: "Saved logs never contain your launch key; it is replaced with [token].",
      });
      if (!target) return { kind: "cancelled" };
      const service = d.redact(await d.compose().logs({ services: SERVICES, tail: 5000, timestamps: true }));
      const text = `== service logs ==\n${service}${service.endsWith("\n") ? "" : "\n"}== shell.log ==\n${shellLogs()}`;
      try {
        writeFileSync(target, d.redact(text), { mode: 0o600 });
      } catch (e) {
        const err = e as NodeJS.ErrnoException;
        if (isDiskFull(err)) return { kind: "disk", where: "mac", detail: `${dirname(target)}: ${err.message}` };
        return { kind: "notice", notice: { tone: "error", text: `The logs couldn't be saved: ${err.message}` } };
      }
      d.log.info("[logs] saved");
      return { kind: "notice", notice: { tone: "info", text: `Logs saved to ${target}.` } };
    },
  };
}

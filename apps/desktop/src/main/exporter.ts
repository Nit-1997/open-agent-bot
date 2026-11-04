import { randomBytes } from "node:crypto";
import { createWriteStream, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { isDiskFull } from "./diskFull.ts";
import type { DockerCli, RunResult } from "./dockerCli.ts";
import { ensurePrivateDir } from "./statePaths.ts";
import { extractEntry, readZipIndex, type ZipIndexEntry, ZipIndexError } from "./zipIndex.ts";
import { formatBytes, lastLines } from "../shared/util.ts";

export { EXPORT_WORDING } from "../shared/wording.ts";
const TOOL = "dist/local/dataTools.js";
const ALLOWED = new Set(["export.json", "open-agent.db"]);
const SECRET_SEGMENT = /^(keys?|kek)(\..*)?$/i;

export type DataStats = Readonly<{ schema: number; dbBytes: number; reports: number; chats: number; reportBytes: number }>;
export type ExportResult =
  | { ok: true; bytes: number; entries: number }
  | { ok: false; reason: "export_invalid" | "disk_full" | "cancelled" | "failed"; where?: "docker" | "mac"; detail?: string };

export function dataToolsArgs(o: { agentRef: string; mount: string; cmd: readonly string[]; name: string }): string[] {
  return [
    "run",
    "--rm",
    "-i",
    "--init",
    "--name",
    o.name,
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    "/tmp:size=64m",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--user",
    "1001:1001",
    "-v",
    o.mount,
    "--entrypoint",
    "node",
    o.agentRef,
    TOOL,
    ...o.cmd,
  ];
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);

export function parseStats(stdout: string): DataStats | undefined {
  try {
    const v = JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as Record<string, unknown>;
    const [schema, dbBytes, reports, chats, reportBytes] = [v.schema, v.dbBytes, v.reports, v.chats, v.reportBytes].map(num);
    if ([schema, dbBytes, reports, chats, reportBytes].some((x) => x === undefined)) return undefined;
    return { schema: schema!, dbBytes: dbBytes!, reports: reports!, chats: chats!, reportBytes: reportBytes! };
  } catch {
    return undefined;
  }
}

type Base = Readonly<{
  cli: DockerCli;
  env: Record<string, string>;
  dataVolume: string;
  agentRef: string;
  namePrefix: string;
  signal?: AbortSignal;
}>;

async function runTool(
  o: Base,
  mount: string,
  cmd: readonly string[],
  opts: { timeoutMs?: number; stdoutTo?: NodeJS.WritableStream; signal?: AbortSignal },
): Promise<RunResult> {
  const name = `${o.namePrefix}-${randomBytes(6).toString("hex")}`;
  const r = await o.cli.run(dataToolsArgs({ agentRef: o.agentRef, mount, cmd, name }), {
    env: o.env,
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts.stdoutTo ? { stdoutTo: opts.stdoutTo } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (opts.signal?.aborted || r.signal) await o.cli.run(["rm", "-f", name], { env: o.env, timeoutMs: 30_000, quiet: true });
  return r;
}

export async function readStats(o: Base): Promise<DataStats | undefined> {
  const r = await runTool(o, `${o.dataVolume}:/data`, ["stats"], { timeoutMs: 60_000, ...(o.signal ? { signal: o.signal } : {}) });
  return r.code === 0 ? parseStats(r.stdout) : undefined;
}

export function verifyExportEntries(names: readonly string[]): { ok: true } | { ok: false; bad: string } {
  for (const name of names) {
    const parts = name.split("/");
    const bad =
      name === "" ||
      name.startsWith("/") ||
      name.includes("\\") ||
      parts.some((p) => p === ".." || p === "." || p === "" || SECRET_SEGMENT.test(p)) ||
      !(ALLOWED.has(name) || (parts[0] === "reports" && parts.length > 1));
    if (bad) return { ok: false, bad: name };
  }
  return { ok: true };
}

export type ExportDeps = Base &
  Readonly<{
    target: string;
    workDir: string;
    signal: AbortSignal;
    freeBytes: (dir: string) => number;
    onPartial?: (path: string) => void;
  }>;

async function checkCredentials(d: ExportDeps, zip: string, db: ZipIndexEntry): Promise<string | undefined> {
  ensurePrivateDir(d.workDir);
  const copy = join(d.workDir, `check-${randomBytes(6).toString("hex")}.db`);
  try {
    await extractEntry(zip, db, copy);
    const r = await runTool(d, `${copy}:/check/open-agent.db:ro`, ["check", "/check/open-agent.db"], {
      timeoutMs: 120_000,
      signal: d.signal,
    });
    if (r.code !== 0) return `the credential check failed (exit ${r.code ?? "none"}) ${lastLines(r.stderr, 3)}`.trim();
    const v = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "{}") as { credentials?: unknown };
    if (v.credentials !== 0) return `the exported database still holds ${String(v.credentials)} credential rows`;
    return undefined;
  } finally {
    rmSync(copy, { force: true });
  }
}

async function verify(d: ExportDeps, zip: string): Promise<string | undefined> {
  let entries: ReturnType<typeof readZipIndex>;
  try {
    entries = readZipIndex(zip);
  } catch (e) {
    return e instanceof ZipIndexError ? e.message : String(e);
  }
  const names = verifyExportEntries(entries.map((e) => e.name));
  if (!names.ok) return `unexpected entry ${names.bad}`;
  const db = entries.find((e) => e.name === "open-agent.db");
  if (!db) return "the export has no database";
  try {
    return await checkCredentials(d, zip, db);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export async function exportData(d: ExportDeps): Promise<ExportResult> {
  const dir = dirname(d.target);
  const stats = await readStats(d);
  if (d.signal.aborted) return { ok: false, reason: "cancelled" };
  if (!stats) return { ok: false, reason: "failed", detail: "the data stats couldn't be read" };
  const need = Math.ceil((stats.dbBytes + stats.reportBytes) * 1.1);
  const free = d.freeBytes(dir);
  if (free < need)
    return {
      ok: false,
      reason: "disk_full",
      where: "mac",
      detail: `${dir} has ${formatBytes(free)} free; the export needs about ${formatBytes(need)}.`,
    };

  const partial = `${d.target}.partial`;
  rmSync(partial, { force: true });
  d.onPartial?.(partial);
  const out = createWriteStream(partial, { flags: "wx", mode: 0o600 });
  let writeError: NodeJS.ErrnoException | undefined;
  const stopOnWriteError = new AbortController();
  out.on("error", (e: NodeJS.ErrnoException) => {
    writeError ??= e;
    stopOnWriteError.abort();
  });
  const drop = () => rmSync(partial, { force: true });
  let r: RunResult;
  try {
    r = await runTool(d, `${d.dataVolume}:/data`, ["export"], {
      stdoutTo: out,
      signal: AbortSignal.any([d.signal, stopOnWriteError.signal]),
    });
  } finally {
    await new Promise<void>((resolve) => (out.closed ? resolve() : out.end(() => resolve())));
  }
  if (d.signal.aborted) {
    drop();
    return { ok: false, reason: "cancelled" };
  }
  if (writeError) {
    drop();
    return isDiskFull(writeError)
      ? { ok: false, reason: "disk_full", where: "mac", detail: `${dir}: ${writeError.message}` }
      : { ok: false, reason: "failed", detail: writeError.message };
  }
  if (r.code !== 0) {
    drop();
    const tail = lastLines(r.stderr, 5);
    if (isDiskFull(r.stderr)) return { ok: false, reason: "disk_full", where: "docker", detail: tail };
    return { ok: false, reason: "failed", detail: `the export exited with ${r.code ?? r.signal ?? "no code"}: ${tail}` };
  }
  const problem = await verify(d, partial);
  if (d.signal.aborted) {
    drop();
    return { ok: false, reason: "cancelled" };
  }
  if (problem) {
    drop();
    return { ok: false, reason: "export_invalid", detail: problem };
  }
  renameSync(partial, d.target);
  return { ok: true, bytes: statSync(d.target).size, entries: readZipIndex(d.target).length };
}

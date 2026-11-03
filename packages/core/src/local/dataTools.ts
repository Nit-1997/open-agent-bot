import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, lstatSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CredentialSchemaError, countCredentials, MissingDatabaseError, readDbStats, takeSnapshot } from "./store/dataSnapshot.js";
import { createZipWriter, type ZipLimits, ZipTooLargeError } from "./zipStream.js";

export const DATA_DIR = "/data";
const DB_FILE = "open-agent.db";
const USER_DIR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REPORT_FILE = /^[A-Za-z0-9_-]{12}\.(html|pdf|jpg)$/;

export type DataStats = Readonly<{ schema: number; dbBytes: number; reports: number; chats: number; reportBytes: number }>;

export type ExportErrorCode = "disk_full" | "too_large" | "unknown_credential_schema" | "outside_data" | "no_database";
const EXIT: Readonly<Record<ExportErrorCode, number>> = {
  too_large: 2,
  disk_full: 3,
  unknown_credential_schema: 4,
  outside_data: 5,
  no_database: 6,
};
const MESSAGE: Readonly<Record<ExportErrorCode, string>> = {
  too_large: "[export] too large: more than 4 GiB or 65535 entries",
  disk_full: "[export] disk full",
  unknown_credential_schema: "[export] unknown credential schema",
  outside_data: "[export] path outside the data folder",
  no_database: "[export] no database",
};

export class ExportError extends Error {
  constructor(
    readonly code: ExportErrorCode,
    detail?: string,
  ) {
    super(detail ? `${MESSAGE[code]}: ${detail}` : MESSAGE[code]);
  }
}

const fileSize = (p: string) => (existsSync(p) ? statSync(p).size : 0);

function insideData(realData: string, path: string): void {
  const real = realpathSync(path);
  if (real !== realData && !real.startsWith(realData + sep)) throw new ExportError("outside_data", path);
}

type ReportFile = Readonly<{ name: string; path: string; size: number }>;

function reportFiles(dataDir: string): ReportFile[] {
  const realData = realpathSync(dataDir);
  const root = join(dataDir, "reports");
  if (!existsSync(root)) return [];
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory()) throw new ExportError("outside_data", root);
  insideData(realData, root);
  const files: ReportFile[] = [];
  for (const user of readdirSync(root).sort()) {
    const dir = join(root, user);
    const st = lstatSync(dir);
    if (st.isSymbolicLink()) throw new ExportError("outside_data", dir);
    if (!st.isDirectory() || !USER_DIR.test(user)) continue;
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const fst = lstatSync(path);
      if (fst.isSymbolicLink()) throw new ExportError("outside_data", path);
      if (!fst.isFile() || !REPORT_FILE.test(name)) continue;
      files.push({ name: `reports/${user}/${name}`, path, size: fst.size });
    }
  }
  return files;
}

export function stats(dataDir: string): DataStats {
  const dbPath = join(dataDir, DB_FILE);
  return {
    ...readDbStats(dbPath),
    dbBytes: fileSize(dbPath) + fileSize(`${dbPath}-wal`),
    reportBytes: reportFiles(dataDir).reduce((a, f) => a + f.size, 0),
  };
}

export type ExportHooks = Readonly<{ afterSnapshot?: (path: string) => void }>;

const LEFTOVER = /^\.export-[0-9a-f]{16}\.db(-journal|-wal|-shm)?$/;

const sweepLeftovers = (backups: string) => {
  if (!existsSync(backups)) return;
  for (const name of readdirSync(backups)) if (LEFTOVER.test(name)) rmSync(join(backups, name), { force: true });
};

const removeSnapshot = (path: string | undefined) => {
  if (!path) return;
  for (const p of [path, `${path}-journal`, `${path}-wal`, `${path}-shm`]) rmSync(p, { force: true });
};

export async function writeExport(o: {
  dataDir: string;
  out: NodeJS.WritableStream;
  version: string;
  now?: () => Date;
  limits?: Partial<ZipLimits>;
  hooks?: ExportHooks;
}): Promise<{ entries: number }> {
  const now = o.now ?? (() => new Date());
  let snap: string | undefined;
  try {
    const reports = reportFiles(o.dataDir);
    sweepLeftovers(join(o.dataDir, "backups"));
    snap = join(o.dataDir, "backups", `.export-${randomBytes(8).toString("hex")}.db`);
    const taken = takeSnapshot(join(o.dataDir, DB_FILE), snap, o.hooks?.afterSnapshot);
    const zip = createZipWriter(o.out, { now, ...(o.limits ? { limits: o.limits } : {}) });
    const meta = {
      app: "open-agent",
      version: o.version,
      schema: taken.schema,
      exportedAt: now().toISOString(),
      kind: "snapshot",
      excludes: ["keys", "saved model keys"],
    };
    await zip.addBuffer("export.json", Buffer.from(JSON.stringify(meta)));
    await zip.addStream(DB_FILE, createReadStream(snap));
    for (const f of reports) await zip.addStream(f.name, createReadStream(f.path));
    const done = await zip.finish();
    return { entries: done.entries };
  } finally {
    removeSnapshot(snap);
  }
}

const isDiskFull = (e: unknown) => {
  const err = e as { code?: string; errcode?: number; message?: string } | null;
  return (
    err?.code === "ENOSPC" ||
    (err?.errcode ?? 0) % 256 === 13 ||
    /database or disk is full|SQLITE_FULL|no space left/i.test(err?.message ?? "")
  );
};

function classify(e: unknown): ExportError | undefined {
  if (e instanceof ExportError) return e;
  if (e instanceof CredentialSchemaError) return new ExportError("unknown_credential_schema", e.message);
  if (e instanceof MissingDatabaseError) return new ExportError("no_database", e.message);
  if (e instanceof ZipTooLargeError) return new ExportError("too_large");
  if (isDiskFull(e)) return new ExportError("disk_full", (e as Error).message);
  return undefined;
}

export type CliIo = Readonly<{
  dataDir?: string;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  version?: string;
  now?: () => Date;
  limits?: Partial<ZipLimits>;
  hooks?: ExportHooks;
}>;

const USAGE = "usage: node dist/local/dataTools.js stats | export | check <db file>\n";

export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const dataDir = io.dataDir ?? DATA_DIR;
  const [cmd, arg] = argv;
  try {
    switch (cmd) {
      case "stats":
        io.stdout.write(`${JSON.stringify(stats(dataDir))}\n`);
        return 0;
      case "check":
        if (!arg) break;
        io.stdout.write(`${JSON.stringify(countCredentials(arg))}\n`);
        return 0;
      case "export": {
        const r = await writeExport({
          dataDir,
          out: io.stdout,
          version: io.version ?? "dev",
          ...(io.now ? { now: io.now } : {}),
          ...(io.limits ? { limits: io.limits } : {}),
          ...(io.hooks ? { hooks: io.hooks } : {}),
        });
        io.stderr.write(`[export] done entries=${r.entries}\n`);
        return 0;
      }
    }
  } catch (e) {
    const known = classify(e);
    if (known) {
      io.stderr.write(`${known.message}\n`);
      return EXIT[known.code];
    }
    io.stderr.write(`[${cmd}] failed: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  io.stderr.write(USAGE);
  return 64;
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
if (invoked) {
  process.umask(0o077);
  const code = await runCli(process.argv.slice(2), {
    stdout: process.stdout,
    stderr: process.stderr,
    version: process.env.OPEN_AGENT_VERSION ?? "dev",
  });
  process.stdout.write("", () => process.exit(code));
}

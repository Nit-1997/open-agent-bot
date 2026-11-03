import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DockerCli, RunOptions, RunResult } from "../src/main/dockerCli.ts";
import { dataToolsArgs, EXPORT_WORDING, exportData, readStats, verifyExportEntries } from "../src/main/exporter.ts";
import { buildZip } from "./fake-docker/zip.mjs";

const REF = `127.0.0.1:18467/oab-a@sha256:${"a".repeat(64)}`;
const STATS = { schema: 1, dbBytes: 1_000_000, reports: 2, chats: 3, reportBytes: 50_000 };

type Mode = "ok" | "evil" | "withCredentials" | "fail" | "noSpace" | "slow" | "badStats";
let dir: string;
let calls: string[][];
let mode: Mode;

const zipOk = (extra: { name: string; data: Buffer }[] = []) =>
  buildZip([
    { name: "export.json", data: Buffer.from('{"app":"open-agent"}') },
    { name: "open-agent.db", data: Buffer.from("SQLite format 3\0fake") },
    { name: "reports/u/AbCdEfGhIjKl.html", data: Buffer.from("<p>r</p>") },
    ...extra,
  ]);

const result = (code: number, stdout = "", stderr = ""): RunResult => ({ code, stdout, stderr, ms: 1 });

const cli: DockerCli = {
  path: "/usr/local/bin/docker",
  run: async (args: readonly string[], o: RunOptions) => {
    calls.push([...args]);
    const cmd = args[args.indexOf("dist/local/dataTools.js") + 1];
    if (cmd === "stats") return mode === "badStats" ? result(1, "", "boom") : result(0, `${JSON.stringify(STATS)}\n`);
    if (cmd === "check") return result(0, JSON.stringify({ credentials: mode === "withCredentials" ? 1 : 0, schema: 1 }));
    if (cmd === "export") {
      if (mode === "fail") return result(1, "", "[export] something broke");
      if (mode === "noSpace") return result(3, "", "[export] disk full: database or disk is full");
      if (mode === "slow")
        return new Promise<RunResult>((resolve) => {
          o.stdoutTo?.write(Buffer.from("PK partial bytes"));
          o.signal?.addEventListener("abort", () => resolve({ code: null, signal: "aborted", stdout: "", stderr: "", ms: 1 }), {
            once: true,
          });
        });
      const zip = mode === "evil" ? zipOk([{ name: "keys/kek", data: Buffer.from("KEK") }]) : zipOk();
      o.stdoutTo?.write(zip);
      return result(0);
    }
    return result(64, "", "unexpected");
  },
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oab-exporter-"));
  calls = [];
  mode = "ok";
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (o: { free?: number; signal?: AbortSignal } = {}) =>
  exportData({
    cli,
    env: { PATH: "/usr/bin" },
    dataVolume: "oab-unit-data",
    agentRef: REF,
    target: join(dir, "export.zip"),
    workDir: join(dir, "work"),
    signal: o.signal ?? new AbortController().signal,
    freeBytes: () => o.free ?? 10 * 1024 ** 3,
  });

const files = () => readdirSync(dir).filter((f) => f !== "work");

describe("dataToolsArgs", () => {
  it("is the exact no-network, read-only, data-volume-only docker run argv (no /keys, no renderer mount)", () => {
    const args = dataToolsArgs({ agentRef: REF, mount: "oab-unit-data:/data", cmd: ["export"] });
    expect(args).toEqual([
      "run",
      "--rm",
      "-i",
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
      "oab-unit-data:/data",
      "--entrypoint",
      "node",
      REF,
      "dist/local/dataTools.js",
      "export",
    ]);
    expect(args.join(" ")).not.toMatch(/keys|renderer|--privileged|--network host/);
  });
});

describe("readStats", () => {
  it("parses the stats line; a failure → undefined", async () => {
    expect(await readStats({ cli, env: {}, dataVolume: "oab-unit-data", agentRef: REF })).toEqual(STATS);
    mode = "badStats";
    expect(await readStats({ cli, env: {}, dataVolume: "oab-unit-data", agentRef: REF })).toBeUndefined();
  });
});

describe("exportData", () => {
  it("streams to <target>.partial, verifies, then renames to the target (0600)", async () => {
    const r = await run();
    expect(r).toEqual({ ok: true, bytes: statSync(join(dir, "export.zip")).size, entries: 3 });
    expect(files()).toEqual(["export.zip"]);
    expect(statSync(join(dir, "export.zip")).mode & 0o777).toBe(0o600);
    const exp = calls.find((c) => c.at(-1) === "export");
    expect(exp).toEqual(dataToolsArgs({ agentRef: REF, mount: "oab-unit-data:/data", cmd: ["export"] }));
    const check = calls.find((c) => c.includes("check"));
    expect(check?.join(" ")).toMatch(/--network none/);
    expect(check?.some((a) => /:\/check\/open-agent\.db:ro$/.test(a))).toBe(true);
    expect(check?.some((a) => a.endsWith(":/data"))).toBe(false);
    expect(existsSync(join(dir, "work")) ? readdirSync(join(dir, "work")) : []).toEqual([]);
  });

  it("a non-zero export exit → the partial is deleted and the reason carries the stderr", async () => {
    mode = "fail";
    expect(await run()).toMatchObject({ ok: false, reason: "failed", detail: expect.stringContaining("something broke") });
    expect(files()).toEqual([]);
  });

  it("an export holding a keys/kek entry is rejected and deleted", async () => {
    mode = "evil";
    expect(await run()).toMatchObject({ ok: false, reason: "export_invalid", detail: expect.stringContaining("keys/kek") });
    expect(files()).toEqual([]);
  });

  it("an export whose db still has provider_credentials rows is rejected and deleted", async () => {
    mode = "withCredentials";
    expect(await run()).toMatchObject({ ok: false, reason: "export_invalid", detail: expect.stringContaining("credential") });
    expect(files()).toEqual([]);
  });

  it("too little free space → disk_full (mac) with the numbers, before the export runs", async () => {
    const r = await run({ free: 1000 });
    expect(r).toMatchObject({ ok: false, reason: "disk_full", where: "mac" });
    if (r.ok) throw new Error("unexpected");
    expect(r.detail).toContain(dir);
    expect(calls.some((c) => c.at(-1) === "export")).toBe(false);
    expect(files()).toEqual([]);
  });

  it("a full Docker disk → disk_full (docker)", async () => {
    mode = "noSpace";
    expect(await run()).toMatchObject({ ok: false, reason: "disk_full", where: "docker" });
    expect(files()).toEqual([]);
  });

  it("abort → cancelled and the partial is deleted", async () => {
    mode = "slow";
    const ac = new AbortController();
    const p = run({ signal: ac.signal });
    await new Promise((r) => setTimeout(r, 50));
    expect(files()).toEqual(["export.zip.partial"]);
    ac.abort();
    expect(await p).toEqual({ ok: false, reason: "cancelled" });
    expect(files()).toEqual([]);
  });

  it("a second export to the same target replaces it (the save dialog confirmed the overwrite)", async () => {
    await run();
    const first = readFileSync(join(dir, "export.zip"));
    expect((await run()).ok).toBe(true);
    expect(readFileSync(join(dir, "export.zip")).length).toBe(first.length);
  });

  it("uses the agreed wording", () => {
    expect(EXPORT_WORDING).toBe("Saved model keys are not included. Chats, reports and your profile are.");
  });
});

describe("verifyExportEntries", () => {
  it.each([
    [["export.json", "open-agent.db", "reports/u/AbCdEfGhIjKl.html"], true],
    [["export.json", "open-agent.db", "open-agent.db-wal", "open-agent.db-shm"], true],
    [["export.json", "keys/kek"], false],
    [["export.json", "kek"], false],
    [["reports/../keys/kek"], false],
    [["/etc/passwd"], false],
    [["reports/u/../../x"], false],
    [["reports\\u\\x"], false],
    [["notes.txt"], false],
    [["reports/keys/a.html"], false],
    [["reports/u/Kek12345678x.html"], true],
  ])("%j → ok=%s", (names, ok) => {
    expect(verifyExportEntries(names).ok).toBe(ok);
  });
});

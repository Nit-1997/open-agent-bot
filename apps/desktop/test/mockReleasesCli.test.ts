import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LATEST_PATH } from "./support/mockReleases.ts";

const DESKTOP = resolve(import.meta.dirname, "..");
const TSX = join(DESKTOP, "../../node_modules/.bin/tsx");
const CLI = join(DESKTOP, "test/support/mockReleasesCli.mts");
const PORT = 18536;

let child: ChildProcess | undefined;
let dir: string | undefined;
afterEach(() => {
  child?.kill("SIGTERM");
  child = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const ready = (c: ChildProcess) =>
  new Promise<void>((res, rej) => {
    let err = "";
    const timer = setTimeout(() => rej(new Error(`no listening line: ${err}`)), 15_000);
    c.stdout?.on("data", (d: Buffer) => {
      if (d.toString().includes("[mock-releases] listening")) {
        clearTimeout(timer);
        res();
      }
    });
    c.stderr?.on("data", (d: Buffer) => {
      err += d.toString();
    });
    c.once("exit", (code) => {
      clearTimeout(timer);
      rej(new Error(`the CLI exited ${code}: ${err}`));
    });
  });

describe("mockReleasesCli.mts", () => {
  it("serves a dry-run mock-release tree with {{ORIGIN}} filled in and logs each request", async () => {
    dir = mkdtempSync(join(tmpdir(), "mock-cli-"));
    mkdirSync(join(dir, "tree/assets"), { recursive: true });
    writeFileSync(
      join(dir, "tree/latest.json"),
      JSON.stringify({ tag_name: "v0.0.0-dryrun.2", assets: [{ name: "m.json", browser_download_url: "{{ORIGIN}}/assets/m.json" }] }),
    );
    writeFileSync(join(dir, "tree/assets/m.json"), '{"version":"0.0.0-dryrun.2"}');
    const log = join(dir, "mock.log");
    child = spawn(TSX, [CLI, "--port", String(PORT), "--dir", join(dir, "tree"), "--log", log], { stdio: ["ignore", "pipe", "pipe"] });
    await ready(child);
    const latest = (await (await fetch(`http://127.0.0.1:${PORT}${LATEST_PATH}`)).json()) as {
      assets: { browser_download_url: string }[];
    };
    expect(latest.assets[0]?.browser_download_url).toBe(`http://127.0.0.1:${PORT}/assets/m.json`);
    expect(await (await fetch(latest.assets[0]?.browser_download_url ?? "")).json()).toEqual({ version: "0.0.0-dryrun.2" });
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([
      JSON.stringify({ method: "GET", path: LATEST_PATH }),
      JSON.stringify({ method: "GET", path: "/assets/m.json" }),
    ]);
  }, 30_000);
});

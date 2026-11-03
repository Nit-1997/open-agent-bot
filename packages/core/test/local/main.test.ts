import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, lstatSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { REFUSAL_EXIT } from "../../src/local/refusal.js";
import { call, type LocalRoot, localEnv, localRoot, waitFor } from "./localHarness.js";

const MAIN = join(import.meta.dirname, "../../dist/local/main.js");
const OPENROUTER_KEY = `sk-or-v1-${"7".repeat(64)}`;
const REFUSED = /\[startup\] refused code=/;
const LISTENING = /^\[local\] listening on 127\.0\.0\.1:(\d+)$/m;

type Run = { child: ChildProcess; out: () => string; exit: Promise<number | null> };

function launch(env: NodeJS.ProcessEnv): Run {
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", MAIN], { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout?.on("data", (d) => {
    out += d;
  });
  child.stderr?.on("data", (d) => {
    out += d;
  });
  const exit = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return { child, out: () => out, exit };
}

async function refusedWith(env: NodeJS.ProcessEnv, code: keyof typeof REFUSAL_EXIT): Promise<string> {
  const run = launch(env);
  const exit = await run.exit;
  const lines = run
    .out()
    .split("\n")
    .filter((l) => REFUSED.test(l));
  expect(lines, run.out()).toHaveLength(1);
  expect(lines[0]).toMatch(new RegExp(`^\\[startup\\] refused code=${code} `));
  expect(exit).toBe(REFUSAL_EXIT[code]);
  return lines[0];
}

async function started(env: NodeJS.ProcessEnv): Promise<Run & { port: number }> {
  const run = launch(env);
  await Promise.race([
    waitFor(() => LISTENING.test(run.out()), 25_000),
    run.exit.then((code) => {
      throw new Error(`exited ${code}: ${run.out()}`);
    }),
  ]);
  return { ...run, port: Number(LISTENING.exec(run.out())?.[1]) };
}

async function stop(run: Run): Promise<number | null> {
  run.child.kill("SIGTERM");
  return run.exit;
}

const mode = (p: string) => (statSync(p).mode & 0o777).toString(8);

beforeAll(() => {
  if (!existsSync(MAIN)) throw new Error(`${MAIN} is missing: build core first (npm run build -w @oab/core)`);
});

let r: LocalRoot;
beforeEach(() => {
  r = localRoot();
});
afterEach(() => r.dispose());

describe("dist/local/main.js", () => {
  it("starts under umask 077: directories 0700 and files 0600, keys hold only kek", async () => {
    const run = await started(localEnv(r));
    try {
      const saved = await call(run.port, "/api/providers/openrouter/key", { method: "POST", body: { apiKey: OPENROUTER_KEY } });
      expect(saved.status).toBe(200);
      for (const dir of [r.data, join(r.data, "reports"), join(r.data, "backups"), r.keys, r.renderer]) expect(mode(dir), dir).toBe("700");
      const files = [
        ...["open-agent.db", "open-agent.db-wal", "open-agent.db-shm"].map((f) => join(r.data, f)),
        join(r.keys, "kek"),
        join(r.renderer, "secret"),
      ];
      for (const file of files) expect(mode(file), file).toBe("600");
      expect(readdirSync(r.keys)).toEqual(["kek"]);
      expect(readdirSync(r.renderer)).toEqual(["secret"]);
      const everything = readdirSync(r.root, { recursive: true }).map(String);
      expect(everything.filter((f) => /secret/i.test(f) && f !== join("renderer", "secret"))).toEqual([]);
    } finally {
      expect(await stop(run)).toBe(0);
    }
    expect(existsSync(join(r.data, "open-agent.db-wal"))).toBe(false);
    expect(run.out()).not.toContain(OPENROUTER_KEY);
  });

  it("refuses hosted settings with config (78)", async () => {
    const line = await refusedWith(localEnv(r, { SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" }), "config");
    expect(line).toContain("SUPABASE_URL");
    expect(line).not.toContain("abcdefghijklmnopqrst");
  });

  it("refuses a corrupt database with db_corrupt (79)", async () => {
    const first = await started(localEnv(r));
    await stop(first);
    writeFileSync(join(r.data, "open-agent.db"), Buffer.alloc(8192, 0x5a));
    await refusedWith(localEnv(r), "db_corrupt");
  });

  it("refuses a newer schema with db_newer (80)", async () => {
    const first = await started(localEnv(r));
    await stop(first);
    const db = new DatabaseSync(join(r.data, "open-agent.db"));
    db.exec("PRAGMA user_version = 99");
    db.close();
    await refusedWith(localEnv(r), "db_newer");
  });

  it("refuses a missing KEK over saved keys (82), then starts once with OPEN_AGENT_RESET_CREDENTIALS=1", async () => {
    const first = await started(localEnv(r));
    await call(first.port, "/api/providers/openrouter/key", { method: "POST", body: { apiKey: OPENROUTER_KEY } });
    await stop(first);
    rmSync(join(r.keys, "kek"));
    const line = await refusedWith(localEnv(r), "kek_missing");
    expect(line).toContain("1 saved model key");
    const reset = await started(localEnv(r, { OPEN_AGENT_RESET_CREDENTIALS: "1" }));
    try {
      expect(reset.out()).toMatch(/OPEN_AGENT_RESET_CREDENTIALS=1: the credential key was missing, so 1 saved model key were deleted/);
      const providers = JSON.parse((await call(reset.port, "/api/providers")).text) as {
        providers: Array<{ id: string; configured: boolean }>;
      };
      expect(providers.providers.find((p) => p.id === "openrouter")).toMatchObject({ configured: false });
    } finally {
      expect(await stop(reset)).toBe(0);
    }
    expect(lstatSync(join(r.keys, "kek")).isFile()).toBe(true);
  });

  it("refuses a symlinked KEK with keyfile_invalid (83)", async () => {
    const first = await started(localEnv(r));
    await stop(first);
    const real = join(r.root, "elsewhere-kek");
    writeFileSync(real, `v1:${Buffer.alloc(32, 1).toString("base64")}\n`, { mode: 0o600 });
    rmSync(join(r.keys, "kek"));
    symlinkSync(real, join(r.keys, "kek"));
    await refusedWith(localEnv(r), "keyfile_invalid");
  });

  it("refuses a missing UI build with ui_missing (84)", async () => {
    const line = await refusedWith(localEnv(r, { OPEN_AGENT_UI_DIR: join(r.root, "no-ui") }), "ui_missing");
    expect(line).toContain("UI build not found at");
  });
});

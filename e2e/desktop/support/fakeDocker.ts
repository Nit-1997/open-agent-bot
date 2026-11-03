import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DESKTOP = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/desktop");
export const FAKE_DIR = join(DESKTOP, "test/fake-docker");

export type FakeAgent = Readonly<{ port: number; origin: string; stop(): Promise<void> }>;

export async function startFakeAgent(o: { port: number; stackFile: string; version?: string }): Promise<FakeAgent> {
  const child: ChildProcess = spawn(process.execPath, [join(FAKE_DIR, "fake-agent.mjs")], {
    env: {
      PATH: process.env.PATH ?? "",
      OPEN_AGENT_PORT: String(o.port),
      FAKE_STACK_FILE: o.stackFile,
      FAKE_AGENT_VERSION: o.version ?? "0.0.0-fake",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((res, rej) => {
    const timer = setTimeout(() => rej(new Error("fake-agent did not start")), 10_000);
    child.stdout?.on("data", (d: Buffer) => {
      if (d.toString().includes("listening")) {
        clearTimeout(timer);
        res();
      }
    });
    child.once("exit", (code) => rej(new Error(`fake-agent exited ${code}`)));
  });
  return {
    port: o.port,
    origin: `http://127.0.0.1:${o.port}`,
    stop: () =>
      new Promise<void>((res) => {
        if (child.exitCode !== null) return res();
        child.once("exit", () => res());
        child.kill("SIGTERM");
      }),
  };
}

export type Recorder = Readonly<{ port: number; hits(): number; stop(): Promise<void> }>;

export async function startRecorder(port: number, host = "127.0.0.1"): Promise<Recorder> {
  let hits = 0;
  const sockets = new Set<Socket>();
  const server: Server = createServer((s) => {
    hits += 1;
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
    s.end("HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok");
  });
  await new Promise<void>((res) => server.listen(port, host, () => res()));
  return {
    port,
    hits: () => hits,
    stop: () =>
      new Promise<void>((res) => {
        for (const s of sockets) s.destroy();
        server.close(() => res());
      }),
  };
}

export type FakeScenario = Record<string, unknown>;
export type CallRecord = Readonly<{
  argv: string[];
  envNames: string[];
  pid: number;
  port?: number;
  tokenFp?: string;
  reset?: boolean;
  images?: { agent?: string; search?: string };
  exitCode?: number;
  signal?: string;
  phase?: string;
}>;

export type FakeDocker = Readonly<{
  home: string;
  bin: string;
  scenario(patch: FakeScenario): void;
  daemon(v: "up" | "down"): void;
  calls(): CallRecord[];
  started(): CallRecord[];
  composeCalls(): CallRecord[];
  state(): {
    containers: Record<string, Record<string, Record<string, unknown>>>;
    images: Record<string, string>;
    removedVolumes?: string[];
  };
  writeState(v: unknown): void;
  cleanup(): Promise<void>;
}>;

const MUTATING = new Set(["up", "start", "stop", "down", "run", "exec", "rm", "pull", "create", "restart", "kill"]);

export const subOf = (r: CallRecord) => {
  if (r.argv[0] !== "compose") return r.argv[0];
  const i = r.argv.indexOf("never");
  return r.argv[i + 1];
};
export const isMutating = (r: CallRecord) =>
  (r.argv[0] === "compose" && MUTATING.has(subOf(r) ?? "")) ||
  ["pull", "volume", "run", "rm", "kill", "stop", "start"].includes(r.argv[0] ?? "");

export async function createFakeDocker(label: string, scenario: FakeScenario = {}): Promise<FakeDocker> {
  const home = mkdtempSync(join(tmpdir(), `oab-fd-${label}-`));
  const bin = join(home, "bin");
  mkdirSync(bin, { mode: 0o755 });
  const docker = join(bin, "docker");
  writeFileSync(
    docker,
    `#!${process.execPath}\nimport(${JSON.stringify(join(FAKE_DIR, "docker.mjs"))}).then((m) => m.main(${JSON.stringify(home)}, process.argv.slice(2)));\n`,
    { mode: 0o755 },
  );
  writeFileSync(join(home, "scenario.json"), JSON.stringify(scenario));
  const sock = createServer();
  await new Promise<void>((res) => sock.listen(join(home, "d.sock"), () => res()));
  const read = <T>(p: string, f: T): T => {
    try {
      return JSON.parse(readFileSync(p, "utf8")) as T;
    } catch {
      return f;
    }
  };
  const records = () =>
    (existsSync(join(home, "calls.jsonl")) ? readFileSync(join(home, "calls.jsonl"), "utf8") : "")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as CallRecord);
  const calls = () => records().filter((r) => r.phase !== "start");
  const self: FakeDocker = {
    home,
    bin: docker,
    scenario: (patch) => writeFileSync(join(home, "scenario.json"), JSON.stringify({ ...read(join(home, "scenario.json"), {}), ...patch })),
    daemon: (v) => writeFileSync(join(home, "daemon.txt"), v),
    calls,
    started: () => records().filter((r) => r.phase === "start"),
    composeCalls: () => calls().filter((r) => r.argv[0] === "compose" && subOf(r) !== undefined),
    state: () => ({ containers: {}, images: {}, ...read(join(home, "state.json"), {}) }),
    writeState: (v) => writeFileSync(join(home, "state.json"), JSON.stringify(v)),
    cleanup: async () => {
      for (const project of Object.values(self.state().containers))
        for (const c of Object.values(project)) {
          const pid = c.pid as number | undefined;
          if (pid)
            try {
              process.kill(pid, "SIGTERM");
            } catch {}
        }
      await new Promise<void>((res) => sock.close(() => res()));
      rmSync(home, { recursive: true, force: true });
    },
  };
  return self;
}

export const ROOT = resolve(DESKTOP, "../..");
export const composeSha = () =>
  createHash("sha256")
    .update(readFileSync(join(ROOT, "docker-compose.yml")))
    .digest("hex");

export function fakeServices(dir: string, o: { version?: string; pull?: boolean; agent?: string; search?: string } = {}): string {
  const file = join(dir, "dev-services.json");
  writeFileSync(
    file,
    JSON.stringify({
      schema: 1,
      kind: "dev",
      version: o.version ?? "0.0.0-fake",
      composeSha256: composeSha(),
      images: {
        agent: o.agent ?? `127.0.0.1:18467/oab-fake-agent@sha256:${"a".repeat(64)}`,
        search: o.search ?? `127.0.0.1:18467/oab-fake-search@sha256:${"b".repeat(64)}`,
      },
      pull: o.pull ?? true,
    }),
  );
  return file;
}

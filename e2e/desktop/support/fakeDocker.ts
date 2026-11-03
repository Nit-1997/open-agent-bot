import { type ChildProcess, spawn } from "node:child_process";
import { createServer, type Server, type Socket } from "node:net";
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

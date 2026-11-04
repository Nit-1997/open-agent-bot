import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

export const REAL = process.env.DESKTOP_REAL_DOCKER === "1";
export const DOCKER = process.env.DESKTOP_REAL_DOCKER_CLI ?? "/usr/local/bin/docker";
export const ENGINE = process.env.DESKTOP_REAL_ENGINE ?? "Docker Desktop";
export const SYSTEM_SOCKET = process.env.OPEN_AGENT_SHELL_ALLOW_SYSTEM_SOCKET === "1";
export const OAB_NAME = /^oab-[a-z0-9-]+$/;

export const dockerEnv = { PATH: `${dirname(DOCKER)}:/usr/bin:/bin`, HOME: process.env.HOME ?? "" };
export const docker = (args: string[]) => execFileSync(DOCKER, args, { encoding: "utf8", env: dockerEnv });
export const fp = (t: string) => createHash("sha256").update(t).digest("hex").slice(0, 12);
export const firstPort = (range: string) => Number(range.split("-")[0]);
export const shellExtra = (): Record<string, string> => (SYSTEM_SOCKET ? { OPEN_AGENT_SHELL_ALLOW_SYSTEM_SOCKET: "1" } : {});

export type DevServices = { images: { agent: string; search: string }; pull?: boolean; version: string };
export const readServices = (file: string) => JSON.parse(readFileSync(file, "utf8")) as DevServices;

export function projectStates(project: string): string[] {
  return docker([
    "ps",
    "-a",
    "--filter",
    `label=com.docker.compose.project=${project}`,
    "--format",
    '{{.Label "com.docker.compose.service"}}={{.State}}',
  ])
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
}

export function containerEnv(project: string, service: string): string[] {
  return JSON.parse(docker(["inspect", "-f", "{{json .Config.Env}}", `${project}-${service}-1`]).trim()) as string[];
}

export function tearDown(o: { project: string; stateDir: string; port: number }): void {
  if (!OAB_NAME.test(o.project)) throw new Error(`refusing to tear down ${o.project}`);
  const stack = join(o.stateDir, "stack");
  if (existsSync(join(stack, "docker-compose.yml")))
    spawnSync(
      DOCKER,
      [
        "compose",
        "-p",
        o.project,
        "-f",
        join(stack, "docker-compose.yml"),
        "--project-directory",
        stack,
        "--env-file",
        "/dev/null",
        "down",
        "-v",
        "--remove-orphans",
      ],
      {
        env: {
          ...dockerEnv,
          OPEN_AGENT_DATA_VOLUME: `${o.project}-data`,
          OPEN_AGENT_KEYS_VOLUME: `${o.project}-keys`,
          OPEN_AGENT_PORT: String(o.port),
        },
        stdio: "ignore",
      },
    );
  spawnSync(DOCKER, ["volume", "rm", `${o.project}-data`, `${o.project}-keys`], { env: dockerEnv, stdio: "ignore" });
  rmSync(o.stateDir, { recursive: true, force: true });
}

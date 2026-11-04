import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = realpathSync(join(dirname(fileURLToPath(import.meta.url)), "../../../.."));

const REQUIRED_ENV_FILES = [
  "cloud/deploy-config/env-files/frontend/.env",
  "deploy-config/.env-agent",
  "deploy-config/.env-renderer",
  "deploy-config/.env-nextjs",
];
const PASS_ENV = ["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY"];

export const cleanEnv = (extra = {}) => ({
  ...Object.fromEntries(PASS_ENV.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])),
  ...extra,
});

export function requireComposeKeepingEnvFiles() {
  const res = spawnSync("docker", ["compose", "version", "--short"], { env: cleanEnv(), encoding: "utf8" });
  const found = res.status === 0 ? res.stdout.trim() : "none";
  if (!(Number.parseInt(found.replace(/^v/, ""), 10) >= 5))
    throw new Error(
      `needs Docker Compose 5 or later, found ${found}: older 'config --no-env-resolution' drops env_file (CI installs it with scripts/ci/compose-plugin.sh)`,
    );
}

export function standIn() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "compose-stand-in-")));
  for (const rel of REQUIRED_ENV_FILES) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), "");
  }
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

export function composeConfig(args, { cwd = ROOT, env = {}, envFile = [], standInDir, projectDir } = {}) {
  const project = projectDir === undefined ? [] : ["--project-directory", join(standInDir, projectDir)];
  const res = spawnSync("docker", ["compose", ...envFile, ...project, ...args, "config", "--format", "json", "--no-env-resolution"], {
    cwd,
    env: cleanEnv(env),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`docker compose ${args.join(" ")} config exited ${res.status} (output not shown)`);
  return JSON.parse(projectDir === undefined ? res.stdout : res.stdout.replaceAll(standInDir, ROOT));
}

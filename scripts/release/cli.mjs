import { spawnSync } from "node:child_process";
import { appendFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const COMPOSE_FILE = join(REPO, "docker-compose.yml");
export const POLICY_FILE = join(REPO, "apps/desktop/release-policy.json");

export const isMain = (url) => {
  try {
    return realpathSync(fileURLToPath(url)) === realpathSync(process.argv[1] ?? "");
  } catch {
    return false;
  }
};

export const spawnRunner =
  (cmd, base = {}) =>
  (args, o = {}) => {
    const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...base, ...o });
    return { status: r.error ? 127 : r.status, stdout: r.stdout ?? "", stderr: r.error ? r.error.message : (r.stderr ?? "") };
  };

export function writeOutputs(outputs, env = process.env) {
  if (!env.GITHUB_OUTPUT) return;
  appendFileSync(
    env.GITHUB_OUTPUT,
    Object.entries(outputs)
      .map(([k, v]) => `${k}=${v}\n`)
      .join(""),
  );
}

export function main(name, fn) {
  try {
    const code = fn();
    if (code instanceof Promise) {
      code.then(
        (c) => process.exit(c ?? 0),
        (e) => {
          process.stderr.write(`${name}: ${e.message}\n`);
          process.exit(1);
        },
      );
      return;
    }
    process.exit(code ?? 0);
  } catch (e) {
    process.stderr.write(`${name}: ${e.message}\n`);
    process.exit(1);
  }
}

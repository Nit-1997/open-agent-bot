import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = "@earendil-works/pi-ai";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function piAiInstalled() {
  const lookup = createRequire(join(root, "packages", "core", "package.json")).resolve.paths(PACKAGE) ?? [];
  return lookup.some((dir) => existsSync(join(dir, PACKAGE, "package.json")));
}

if (!piAiInstalled()) {
  console.log("pi-ai not installed, patches skipped");
  process.exit(0);
}

const result = spawnSync("patch-package", ["--error-on-fail"], { cwd: root, stdio: "inherit" });
if (result.error) {
  console.error(`patch-package failed to start: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);

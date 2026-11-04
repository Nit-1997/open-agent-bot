import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const BIOME = createRequire(import.meta.url).resolve("@biomejs/biome/bin/biome");
const PACKAGES = join(import.meta.dirname, "../../..");

export function biomeFixtures(prefix: string) {
  const work = mkdtempSync(join(tmpdir(), prefix));
  let n = 0;
  return {
    lint(pkg: string, file: string, code: string, base = join(PACKAGES, pkg, "biome.json")) {
      const root = join(work, String(n++), "packages", pkg);
      mkdirSync(dirname(join(root, file)), { recursive: true });
      const config = { extends: [base], files: { includes: ["src/**/*.ts"] } };
      writeFileSync(join(root, "biome.json"), JSON.stringify(config));
      writeFileSync(join(root, file), code);
      const res = spawnSync(process.execPath, [BIOME, "lint", "--colors=off", file], { cwd: root, encoding: "utf8" });
      return { status: res.status, out: `${res.stdout}${res.stderr}` };
    },
    dispose: () => rmSync(work, { recursive: true, force: true }),
  };
}

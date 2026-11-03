#!/usr/bin/env node
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(APP, "dist");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "screens"), { recursive: true });

const node = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  external: ["electron"],
  logLevel: "warning",
  legalComments: "none",
};

await Promise.all([
  build({ ...node, entryPoints: [join(APP, "src/main/main.ts")], outfile: join(out, "main.cjs") }),
  build({ ...node, entryPoints: [join(APP, "src/preload-shell.ts")], outfile: join(out, "preload-shell.cjs") }),
  build({ ...node, entryPoints: [join(APP, "src/preload-app.ts")], outfile: join(out, "preload-app.cjs") }),
  build({
    entryPoints: [join(APP, "src/screens/screens.ts")],
    outfile: join(out, "screens/screens.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "chrome140",
    logLevel: "warning",
    legalComments: "none",
  }),
]);

for (const f of ["index.html", "screens.css"]) copyFileSync(join(APP, "src/screens", f), join(out, "screens", f));
process.stdout.write("desktop build: dist/main.cjs, dist/preload-shell.cjs, dist/preload-app.cjs, dist/screens/\n");

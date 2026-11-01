#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = resolve(process.env.DEMO_RESULTS ?? resolve(HERE, "../test-results"));
const OUT = process.env.DEMO_OUT ?? join(homedir(), "Downloads", "app-shell-demo.mp4");
const PROJECTS = ["desktop", "tablet", "phone"];
const SIZE = { width: 1440, height: 900 };

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (spawnSync("ffmpeg", ["-version"]).status !== 0) fail("ffmpeg is not installed. Install it (brew install ffmpeg) and run this again.");

const dirs = (() => {
  try {
    return readdirSync(RESULTS, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return fail(`No recordings in ${RESULTS}. Run npx playwright test first.`);
  }
})();

const clips = PROJECTS.flatMap((project) =>
  dirs
    .filter((d) => d.name.endsWith(`-${project}`))
    .flatMap((d) =>
      readdirSync(join(RESULTS, d.name))
        .filter((f) => f.endsWith(".webm"))
        .map((f) => join(RESULTS, d.name, f)),
    )
    .sort((a, b) => statSync(a).birthtimeMs - statSync(b).birthtimeMs),
);
if (!clips.length) fail(`No .webm recordings in ${RESULTS}. Run npx playwright test first.`);

const fit = (i) =>
  `[${i}:v]scale=${SIZE.width}:${SIZE.height}:force_original_aspect_ratio=decrease,pad=${SIZE.width}:${SIZE.height}:(ow-iw)/2:(oh-ih)/2:color=0x0f1012,setsar=1,fps=25[v${i}]`;
const filter = `${clips.map((_, i) => fit(i)).join(";")};${clips.map((_, i) => `[v${i}]`).join("")}concat=n=${clips.length}:v=1:a=0[out]`;

execFileSync(
  "ffmpeg",
  [
    "-y",
    "-loglevel",
    "error",
    ...clips.flatMap((c) => ["-i", c]),
    "-filter_complex",
    filter,
    "-map",
    "[out]",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "22",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    OUT,
  ],
  { stdio: "inherit" },
);

const duration = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", OUT], {
  encoding: "utf8",
}).trim();
console.log(`${OUT} · ${Number(duration).toFixed(1)} s from ${clips.length} clips`);

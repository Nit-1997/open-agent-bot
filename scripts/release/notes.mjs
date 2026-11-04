#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { isMain, main, REPO, spawnRunner } from "./cli.mjs";
import { baseImages, notes, parseTag, previousFinalTag, releaseImage } from "./releaseLib.mjs";

export function gitChanges(git, ref, previous, max) {
  const range = previous ? `${previous}..${ref}` : ref;
  const r = git(["log", "--oneline", "--no-decorate", range]);
  if (r.status !== 0) throw new Error(`git log ${range} exited ${r.status}: ${r.stderr.trim()}`);
  const all = r.stdout.split("\n").filter(Boolean);
  return max && all.length > max ? [...all.slice(0, max), `… and ${all.length - max} more`] : all;
}

export function notesCommand(argv, git = spawnRunner("git", { cwd: REPO }), env = process.env) {
  const { values } = parseArgs({
    args: argv,
    options: {
      version: { type: "string" },
      lock: { type: "string" },
      out: { type: "string" },
      ref: { type: "string" },
      "max-changes": { type: "string" },
    },
  });
  for (const k of ["version", "lock", "out"]) if (!values[k]) throw new Error(`pass --${k}`);
  const tag = `v${values.version}`;
  const parsed = parseTag(tag, { dryRun: env.OPEN_AGENT_SHELL_TEST === "1" });
  if (!parsed.ok) throw new Error(parsed.reason);
  const lock = JSON.parse(readFileSync(values.lock, "utf8"));
  const bases = baseImages(
    readFileSync(join(REPO, releaseImage("agent").dockerfile), "utf8"),
    readFileSync(join(REPO, releaseImage("search").dockerfile), "utf8"),
  );
  const tags = git(["tag", "--list", "v*"]);
  if (tags.status !== 0) throw new Error(`git tag --list exited ${tags.status}: ${tags.stderr.trim()}`);
  const previousTag = previousFinalTag(tags.stdout.split("\n").filter(Boolean), tag);
  const max = values["max-changes"] ? Number(values["max-changes"]) : undefined;
  const changes = gitChanges(git, values.ref ?? tag, previousTag, max);
  const text = notes({ version: values.version, prerelease: parsed.prerelease, digests: lock.images, bases, changes, previousTag });
  const out = resolve(values.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text, { mode: 0o644 });
  return { out, previousTag, changes: changes.length };
}

if (isMain(import.meta.url))
  main("notes", () => {
    const r = notesCommand(process.argv.slice(2));
    process.stdout.write(`notes: wrote ${r.out} (${r.changes} change lines since ${r.previousTag ?? "the first commit"})\n`);
    return 0;
  });

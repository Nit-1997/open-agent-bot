#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { COMPOSE_FILE, isMain, main } from "./cli.mjs";
import { assertReleaseLock, composeSha256, modeProblems } from "./releaseLib.mjs";

export function assertLock(argv, env, o = {}) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      version: { type: "string" },
      attested: { type: "string" },
      "dry-run": { type: "boolean" },
    },
  });
  if (positionals.length !== 1 || !values.version)
    throw new Error("usage: assert-lock.mjs <lock> --version <v> (--attested <file> | --dry-run)");
  const dryRun = values["dry-run"] === true;
  const problems = modeProblems({ dryRun, attested: values.attested, version: values.version, env });
  if (problems.length) return problems;
  const bytes = readFileSync(positionals[0]);
  let lock;
  try {
    lock = JSON.parse(bytes.toString("utf8"));
  } catch {
    return [`${positionals[0]} is not JSON`];
  }
  return assertReleaseLock(lock, {
    version: values.version,
    composeSha256: o.composeSha256 ?? composeSha256(COMPOSE_FILE),
    dryRun,
    ...(values.attested ? { attested: JSON.parse(readFileSync(values.attested, "utf8")) } : {}),
  });
}

if (isMain(import.meta.url))
  main("assert-lock", () => {
    const problems = assertLock(process.argv.slice(2), process.env);
    for (const p of problems) process.stderr.write(`assert-lock: ${p}\n`);
    if (problems.length) return 1;
    process.stdout.write("assert-lock: ok\n");
    return 0;
  });

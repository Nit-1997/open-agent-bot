#!/usr/bin/env node
import { parseArgs } from "node:util";
import { isMain, main, writeOutputs } from "./cli.mjs";
import { parseTag } from "./releaseLib.mjs";

export function versionCommand(argv, env) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { "dry-run": { type: "boolean" } } });
  if (positionals.length !== 1) throw new Error("usage: version.mjs <tag> [--dry-run]");
  if (values["dry-run"] && env.OPEN_AGENT_SHELL_TEST !== "1") throw new Error("--dry-run needs OPEN_AGENT_SHELL_TEST=1");
  const p = parseTag(positionals[0], { dryRun: values["dry-run"] });
  if (!p.ok) throw new Error(p.reason);
  return { version: p.version, prerelease: String(p.prerelease), tag: p.tag };
}

if (isMain(import.meta.url))
  main("version", () => {
    const out = versionCommand(process.argv.slice(2), process.env);
    process.stdout.write(`${out.version}\n`);
    writeOutputs({ version: out.version, prerelease: out.prerelease });
    return 0;
  });

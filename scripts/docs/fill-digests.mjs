#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { isMain, main } from "../release/cli.mjs";
import { guideVersion, MANIFEST_FILE, REPO } from "./doc-commands.mjs";

const INSTALL = join(REPO, "docs/INSTALL.md");
const IMAGES = Object.freeze({
  agent: { name: "ghcr.io/nit-1997/open-agent", placeholder: "<agent-digest>" },
  search: { name: "ghcr.io/nit-1997/open-agent-search", placeholder: "<search-digest>" },
});
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const refPattern = (name) => new RegExp(`(?<![\\w.-])${esc(name)}@sha256:(?:[0-9a-f]{64}|<(?:agent|search)-digest>)(?![\\w-])`, "g");

function rewrite(text, digestOf, what = "the guide") {
  let hits = 0;
  let out = text;
  for (const [key, { name }] of Object.entries(IMAGES))
    out = out.replace(refPattern(name), () => {
      hits++;
      return `${name}@sha256:${digestOf(key)}`;
    });
  if (!hits) throw new Error(`${what} has no image refs to fill (expected the §9 printf line)`);
  return out;
}

export function digestsOf(manifest, version) {
  if (manifest?.version !== version) throw new Error(`the manifest is for version ${manifest?.version}, the guide says ${version}`);
  const digests = {};
  for (const [key, { name }] of Object.entries(IMAGES)) {
    const ref = manifest.images?.[key];
    const m = new RegExp(`^${esc(name)}@sha256:([0-9a-f]{64})$`).exec(ref ?? "");
    if (!m) throw new Error(`images.${key} must be ${name}@sha256:<64 hex>, got ${ref}`);
    digests[key] = m[1];
  }
  return digests;
}

export const applyDigests = (text, digests, what) => rewrite(text, (key) => digests[key], what);

export function fillDigests(text, manifest) {
  return applyDigests(text, digestsOf(manifest, guideVersion(text)));
}

export const resetDigests = (text, what) => rewrite(text, (key) => IMAGES[key].placeholder, what);

function cli(argv) {
  const { values } = parseArgs({ args: argv, options: { manifest: { type: "string" }, reset: { type: "boolean" } } });
  if (!values.manifest === !values.reset) throw new Error("pass --manifest <open-agent-services.json> or --reset");
  const text = readFileSync(INSTALL, "utf8");
  const commands = readFileSync(MANIFEST_FILE, "utf8");
  const digests = values.reset ? undefined : digestsOf(JSON.parse(readFileSync(values.manifest, "utf8")), guideVersion(text));
  const apply = (t, what) => (digests ? applyDigests(t, digests, what) : resetDigests(t, what));
  const next = [apply(text, "docs/INSTALL.md"), apply(commands, "scripts/docs/doc-commands.json")];
  writeFileSync(INSTALL, next[0]);
  writeFileSync(MANIFEST_FILE, next[1]);
  process.stdout.write(
    `docs/INSTALL.md and scripts/docs/doc-commands.json: ${digests ? `digests filled (agent ${digests.agent}, search ${digests.search})` : "placeholders restored"}\n`,
  );
  return 0;
}

if (isMain(import.meta.url)) main("fill-digests", () => cli(process.argv.slice(2)));

#!/usr/bin/env node
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { isMain, main, writeOutputs } from "./cli.mjs";
import { parseTag } from "./releaseLib.mjs";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ARCHES = ["amd64", "arm64"];
export const IMAGE_NAMES = Object.freeze({ agent: "ghcr.io/nit-1997/open-agent", search: "ghcr.io/nit-1997/open-agent-search" });
const FILE_OF = { agent: "open-agent.json", search: "open-agent-search.json" };

const checkVersion = (version) => {
  const p = parseTag(`v${version}`);
  if (!p.ok || version.startsWith("v")) throw new Error(`--version ${JSON.stringify(version)} must be a release version without the v`);
};
const checkDigest = (digest, what) => {
  if (!DIGEST.test(digest ?? "")) throw new Error(`${what} ${JSON.stringify(digest)} is not sha256:<64 hex>`);
};
const exactFiles = (dir, want) => {
  const have = readdirSync(dir).sort();
  const missing = want.filter((n) => !have.includes(n));
  const extra = have.filter((n) => !want.includes(n));
  if (missing.length || extra.length)
    throw new Error(`${dir} must hold exactly [${want.join(", ")}]: missing [${missing.join(", ")}], extra [${extra.join(", ")}]`);
};

export function record({ arch, digest, dir }) {
  if (!ARCHES.includes(arch)) throw new Error(`--arch must be one of ${ARCHES.join(", ")}, got ${JSON.stringify(arch)}`);
  checkDigest(digest, "--digest");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, arch), `${digest}\n`);
  return { file: join(dir, arch) };
}

export function mergeInputs({ dir, name, version, sha }) {
  if (!Object.values(IMAGE_NAMES).includes(name)) throw new Error(`--name ${JSON.stringify(name)} is not a release image name`);
  checkVersion(version);
  if (!/^[0-9a-f]{40}$/.test(sha ?? "")) throw new Error(`--sha ${JSON.stringify(sha)} is not a 40-hex commit`);
  exactFiles(dir, ARCHES);
  const refs = {};
  for (const arch of ARCHES) {
    const digest = readFileSync(join(dir, arch), "utf8").trim();
    checkDigest(digest, `${arch} digest`);
    refs[arch] = `${name}@${digest}`;
  }
  return { ...refs, version_tag: `${name}:${version}`, sha_tag: `${name}:sha-${sha.slice(0, 7)}` };
}

export function lockInputs({ dir, version, outDir }) {
  checkVersion(version);
  exactFiles(dir, Object.values(FILE_OF).sort());
  const out = {};
  for (const [svc, file] of Object.entries(FILE_OF)) {
    let entry;
    try {
      entry = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch {
      throw new Error(`${file} is not JSON`);
    }
    if (entry?.name !== IMAGE_NAMES[svc]) throw new Error(`${file} names ${JSON.stringify(entry?.name)}, expected ${IMAGE_NAMES[svc]}`);
    checkDigest(entry.digest, `${file} digest`);
    out[svc] = `${entry.name}@${entry.digest}`;
    out[`${svc}_tag`] = `${entry.name}:${version}`;
  }
  mkdirSync(outDir, { recursive: true });
  return { agent: out.agent, search: out.search, agent_tag: out.agent_tag, search_tag: out.search_tag };
}

export function refsCommand(argv) {
  const [sub, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      arch: { type: "string" },
      digest: { type: "string" },
      dir: { type: "string" },
      name: { type: "string" },
      version: { type: "string" },
      sha: { type: "string" },
      "out-dir": { type: "string" },
    },
  });
  const need = (...ks) => {
    for (const k of ks) if (!values[k]) throw new Error(`${sub} needs --${k}`);
  };
  if (sub === "record") {
    need("arch", "digest", "dir");
    const r = record(values);
    process.stdout.write(`refs: recorded ${values.arch} ${values.digest} in ${r.file}\n`);
    return 0;
  }
  if (sub === "merge-inputs") {
    need("dir", "name", "version", "sha");
    const out = mergeInputs(values);
    for (const [k, v] of Object.entries(out)) process.stdout.write(`refs: ${k}=${v}\n`);
    writeOutputs(out);
    return 0;
  }
  if (sub === "lock-inputs") {
    need("dir", "version", "out-dir");
    const out = lockInputs({ dir: values.dir, version: values.version, outDir: values["out-dir"] });
    for (const [k, v] of Object.entries(out)) process.stdout.write(`refs: ${k}=${v}\n`);
    writeOutputs(out);
    return 0;
  }
  throw new Error("usage: refs.mjs record|merge-inputs|lock-inputs …");
}

if (isMain(import.meta.url)) main("refs", () => refsCommand(process.argv.slice(2)));

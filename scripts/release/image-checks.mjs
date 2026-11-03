#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { isMain, main, spawnRunner, writeOutputs } from "./cli.mjs";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const tail = (r) => (r.stderr || r.stdout).trim().split("\n").slice(-5).join("\n");

const pullFirst = (docker, image, platform) => {
  const r = docker(["pull", "--quiet", ...(platform ? ["--platform", platform] : []), image]);
  if (r.status !== 0) throw new Error(`docker pull ${image} exited ${r.status}: ${tail(r)}`);
};

export function contentCheck({ docker, image, dir }) {
  const r = docker([
    "run",
    "--rm",
    "--pull",
    "never",
    "--entrypoint",
    "sh",
    image,
    "-c",
    `find '${dir}' \\( -name '.env*' -o -name '*.pem' -o -name .factory \\) -print`,
  ]);
  if (r.status !== 0) return { ok: false, lines: [`content: docker run exited ${r.status}: ${tail(r)}`] };
  const hits = r.stdout.split("\n").filter(Boolean);
  return {
    ok: hits.length === 0,
    lines: [`content: forbidden files in ${image} under ${dir}: ${hits.length}`, ...hits.map((h) => `content: found ${h}`)],
  };
}

export function labelsCheck({ docker, image, version, revision, platform, pull }) {
  if (pull) pullFirst(docker, image, platform);
  const r = docker(["image", "inspect", image, "--format", "{{json .Config.Labels}}"]);
  if (r.status !== 0) return { ok: false, lines: [`labels: docker image inspect exited ${r.status}: ${tail(r)}`] };
  let labels;
  try {
    labels = JSON.parse(r.stdout) ?? {};
  } catch {
    return { ok: false, lines: [`labels: cannot parse ${r.stdout.trim()}`] };
  }
  const got = { version: labels["org.opencontainers.image.version"], revision: labels["org.opencontainers.image.revision"] };
  const lines = [`labels: ${image} version=${got.version} revision=${got.revision}`];
  if (got.version !== version) lines.push(`labels: version label ${got.version} differs from ${version}`);
  if (got.revision !== revision) lines.push(`labels: revision label ${got.revision} differs from ${revision}`);
  return { ok: lines.length === 1, lines };
}

export function nodeCheck({ docker, image, platform }) {
  const r = docker(["run", "--rm", "--platform", platform, "--entrypoint", "node", image, "-p", "process.versions.node"]);
  if (r.status !== 0) return { ok: false, lines: [`node: docker run exited ${r.status}: ${tail(r)}`] };
  const v = r.stdout.trim();
  const ok = /^24\.\d+\.\d+$/.test(v);
  return { ok, lines: [`node: ${image} ${platform} runs Node ${v}${ok ? "" : ", expected 24.x"}`] };
}

export function mergeDigest({ metadata, inspectJson }) {
  let digest;
  if (metadata !== undefined) {
    const m = JSON.parse(metadata);
    digest = m["containerimage.digest"] ?? m["containerimage.descriptor"]?.digest;
  } else if (inspectJson !== undefined) digest = JSON.parse(inspectJson)?.digest;
  if (!DIGEST.test(digest ?? ""))
    throw new Error(`no sha256 index digest in the ${metadata !== undefined ? "metadata file" : "inspect JSON"}`);
  return digest;
}

const report = (r) => {
  for (const l of r.lines) process.stdout.write(`${l}\n`);
  return r.ok ? 0 : 1;
};

export function imageChecks(argv, docker = spawnRunner("docker")) {
  const [sub, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      image: { type: "string" },
      dir: { type: "string" },
      version: { type: "string" },
      revision: { type: "string" },
      platform: { type: "string" },
      pull: { type: "boolean" },
      metadata: { type: "string" },
      name: { type: "string" },
    },
  });
  const need = (...ks) => {
    for (const k of ks) if (!values[k]) throw new Error(`${sub} needs --${k}`);
  };
  if (sub === "content") {
    need("image", "dir");
    return report(contentCheck({ docker, image: values.image, dir: values.dir }));
  }
  if (sub === "labels") {
    need("image", "version", "revision");
    return report(labelsCheck({ docker, ...values }));
  }
  if (sub === "node") {
    need("image", "platform");
    return report(nodeCheck({ docker, image: values.image, platform: values.platform }));
  }
  if (sub === "merge-digest") {
    const digest = values.metadata
      ? mergeDigest({ metadata: readFileSync(values.metadata, "utf8") })
      : mergeDigest({ inspectJson: readFileSync(0, "utf8") });
    process.stdout.write(`merge-digest: ${values.name ? `${values.name}@` : ""}${digest}\n`);
    writeOutputs({ ...(values.name ? { name: values.name } : {}), digest });
    return 0;
  }
  throw new Error("usage: image-checks.mjs content|labels|node|merge-digest …");
}

if (isMain(import.meta.url)) main("image-checks", () => imageChecks(process.argv.slice(2)));

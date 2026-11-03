import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const REPO_SLUG = "Nit-1997/open-agent-bot";
export const SIGNER_WORKFLOW = `${REPO_SLUG}/.github/workflows/release.yml`;
export const PRODUCTION_REFS = Object.freeze({
  agent: /^ghcr\.io\/nit-1997\/open-agent@sha256:[0-9a-f]{64}$/,
  search: /^ghcr\.io\/nit-1997\/open-agent-search@sha256:[0-9a-f]{64}$/,
});
export const LOCAL_REGISTRY_REF = /^127\.0\.0\.1:18\d{3}\/oab-[a-z0-9-]+@sha256:[0-9a-f]{64}$/;
export const DRY_RUN_VERSION = /^0\.0\.0-dryrun\.(0|[1-9]\d*)$/;
export const MANIFEST_NAME = "open-agent-services.json";
export const SUMS_NAME = "SHA256SUMS";

const RELEASE_TAG = /^v((0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-rc\.(0|[1-9]\d*))?)$/;
const DRY_RUN_TAG = /^v(0\.0\.0-dryrun\.(0|[1-9]\d*))$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;
const FINAL_TAG = /^v(\d+\.\d+\.\d+)$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function parseTag(tag, o = {}) {
  if (typeof tag !== "string") return { ok: false, reason: "tag is not a string" };
  const m = RELEASE_TAG.exec(tag);
  if (m) return { ok: true, tag, version: m[1], prerelease: m[5] !== undefined };
  if (o.dryRun) {
    const d = DRY_RUN_TAG.exec(tag);
    if (d) return { ok: true, tag, version: d[1], prerelease: false };
  }
  return {
    ok: false,
    reason: `tag ${JSON.stringify(tag)} must match v<major>.<minor>.<patch> or v<major>.<minor>.<patch>-rc.<n>${o.dryRun ? " (or v0.0.0-dryrun.<n> in a dry run)" : ""}`,
  };
}

export function versionOf(tag, o = {}) {
  const p = parseTag(tag, o);
  if (!p.ok) throw new Error(p.reason);
  return p.version;
}

export function parseSemver(v) {
  const m = typeof v === "string" ? SEMVER.exec(v) : null;
  if (!m) return undefined;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] };
}

const comparePre = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const p = a[i];
    const q = b[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return BigInt(p) < BigInt(q) ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
};

export function compareSemver(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) throw new Error(`not semver: ${!x ? a : b}`);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (x.pre === undefined) return 1;
  if (y.pre === undefined) return -1;
  return comparePre(x.pre.split("."), y.pre.split("."));
}

export function checkPolicy(policy, version) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return ["release-policy.json is not an object"];
  const keys = Object.keys(policy);
  if (keys.length !== 1 || keys[0] !== "minShellVersion")
    return [`release-policy.json must hold only minShellVersion, got ${keys.join(", ")}`];
  if (!parseSemver(policy.minShellVersion) || /-/.test(policy.minShellVersion))
    return [`minShellVersion ${JSON.stringify(policy.minShellVersion)} is not <major>.<minor>.<patch>`];
  const v = parseSemver(version);
  if (!v) return [`version ${JSON.stringify(version)} is not semver`];
  if (compareSemver(policy.minShellVersion, v.core.join(".")) > 0)
    return [`minShellVersion ${policy.minShellVersion} is above the release version ${version}`];
  return [];
}

export const composeSha256 = (path) => sha256Hex(readFileSync(path));

export const digestOfRef = (ref) => {
  const at = ref.lastIndexOf("@");
  return at < 0 ? undefined : ref.slice(at + 1);
};
export const nameOfRef = (ref) => {
  const at = ref.lastIndexOf("@");
  return at < 0 ? ref : ref.slice(0, at);
};

export const indexDigest = (raw) => `sha256:${sha256Hex(typeof raw === "string" ? Buffer.from(raw, "utf8") : raw)}`;

const INDEX_TYPES = new Set(["application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json"]);
const ATTESTATION = "attestation-manifest";
const WANT_PLATFORMS = ["linux/amd64", "linux/arm64"];

export function checkIndex(raw, o) {
  const fail = (reason) => ({ ok: false, reason });
  const actual = indexDigest(raw);
  if (o.digest !== undefined && actual !== o.digest) return fail(`the raw index hashes to ${actual}, not the ref's ${o.digest}`);
  let doc;
  try {
    doc = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
  } catch {
    return fail("the raw index is not JSON");
  }
  if (!INDEX_TYPES.has(doc?.mediaType)) return fail(`media type ${doc?.mediaType} is not an OCI image index or a Docker manifest list`);
  const entries = Array.isArray(doc.manifests) ? doc.manifests : [];
  const platforms = [];
  const attestations = [];
  for (const m of entries) {
    const p = m?.platform ?? {};
    const name = `${p.os}/${p.architecture}${p.variant ? `/${p.variant}` : ""}`;
    if (name === "unknown/unknown") {
      if (m.annotations?.["vnd.docker.reference.type"] !== ATTESTATION)
        return fail(`an unknown/unknown entry ${m.digest} is not an attestation manifest`);
      attestations.push({ digest: m.digest, for: m.annotations["vnd.docker.reference.digest"] });
      continue;
    }
    if (!DIGEST.test(m?.digest ?? "")) return fail(`platform ${name} has no sha256 digest`);
    platforms.push({ platform: name, digest: m.digest });
  }
  const names = platforms.map((p) => p.platform).sort();
  if (JSON.stringify(names) !== JSON.stringify(WANT_PLATFORMS))
    return fail(`platforms are [${names.join(", ")}], expected exactly [${WANT_PLATFORMS.join(", ")}]`);
  const known = new Set(platforms.map((p) => p.digest));
  for (const a of attestations)
    if (!known.has(a.for)) return fail(`attestation manifest ${a.digest} points at ${a.for}, which is not a listed platform manifest`);
  if (o.tagDigest !== undefined && o.tagDigest !== actual)
    return fail(`the version tag resolves to ${o.tagDigest}, not the index ${actual}`);
  return { ok: true, digest: actual, platforms, attestations };
}

export function buildLock({ version, composeSha256: compose, agent, search }) {
  return { schema: 1, kind: "release", version, composeSha256: compose, images: { agent, search }, pull: true };
}

export function buildManifest(lock, minShellVersion) {
  return { ...lock, minShellVersion };
}

export const stableJson = (v) => `${JSON.stringify(v, null, 2)}\n`;

export function refProblems(images, o) {
  const out = [];
  for (const svc of ["agent", "search"]) {
    const ref = images?.[svc];
    if (typeof ref !== "string") {
      out.push(`images.${svc} is missing`);
      continue;
    }
    if (o.dryRun) {
      if (!LOCAL_REGISTRY_REF.test(ref)) out.push(`images.${svc} ${ref} is not a local-registry ref (127.0.0.1:18xxx/oab-…@sha256:…)`);
      if (!nameOfRef(ref).endsWith(svc === "agent" ? "-open-agent" : "-open-agent-search"))
        out.push(`images.${svc} ${ref} does not name the ${svc} image`);
    } else if (!PRODUCTION_REFS[svc].test(ref)) out.push(`images.${svc} ${ref} is not a production ref (${PRODUCTION_REFS[svc].source})`);
  }
  return out;
}

export function attestedProblems(images, attested) {
  const out = [];
  for (const svc of ["agent", "search"]) {
    const a = attested?.[svc];
    const ref = images?.[svc];
    if (a?.verified !== true) {
      out.push(`attested.json has no verified ${svc} entry`);
      continue;
    }
    if (a.ref !== ref) out.push(`attested.json ${svc} ref ${a.ref} differs from ${ref}`);
    if (typeof ref === "string" && a.digest !== digestOfRef(ref))
      out.push(`attested.json ${svc} digest ${a.digest} differs from ${digestOfRef(ref)}`);
  }
  return out;
}

export function modeProblems(o) {
  if (o.dryRun && o.attested) return ["use --attested or --dry-run, not both"];
  if (!o.dryRun && !o.attested) return ["pass --attested <file> (release) or --dry-run (test mode)"];
  if (o.dryRun) {
    const out = [];
    if (o.env?.OPEN_AGENT_SHELL_TEST !== "1") out.push("--dry-run needs OPEN_AGENT_SHELL_TEST=1");
    if (!DRY_RUN_VERSION.test(o.version ?? "")) out.push(`--dry-run needs a 0.0.0-dryrun.<n> version, got ${o.version}`);
    return out;
  }
  return DRY_RUN_VERSION.test(o.version ?? "") ? [`${o.version} is a dry-run version; it never takes --attested`] : [];
}

export function assertReleaseLock(lock, o) {
  const out = [];
  if (!lock || typeof lock !== "object" || Array.isArray(lock)) return ["the lock is not a JSON object"];
  if (lock.schema !== 1) out.push(`schema is ${JSON.stringify(lock.schema)}, expected 1`);
  if (lock.kind !== "release") out.push(`kind is ${JSON.stringify(lock.kind)}, expected "release"`);
  if (lock.images === null || typeof lock.images !== "object")
    out.push(`images is ${JSON.stringify(lock.images)}, expected {agent, search}`);
  else {
    const keys = Object.keys(lock.images).sort();
    if (JSON.stringify(keys) !== '["agent","search"]') out.push(`images has keys [${keys.join(", ")}], expected exactly agent and search`);
    out.push(...refProblems(lock.images, { dryRun: o.dryRun }));
    if (o.attested) out.push(...attestedProblems(lock.images, o.attested));
  }
  if ("imageIds" in lock) out.push("imageIds is present (only local builds carry image Ids)");
  if (lock.pull !== true) out.push(`pull is ${JSON.stringify(lock.pull)}, expected true`);
  if (lock.version !== o.version) out.push(`version is ${JSON.stringify(lock.version)}, expected ${JSON.stringify(o.version)}`);
  if (lock.composeSha256 !== o.composeSha256)
    out.push(`composeSha256 ${lock.composeSha256} differs from the root compose file ${o.composeSha256}`);
  if ("minShellVersion" in lock) out.push("minShellVersion is present (the bundled lock never carries it; only the manifest does)");
  const known = new Set(["schema", "kind", "version", "composeSha256", "images", "pull", "imageIds", "minShellVersion"]);
  for (const k of Object.keys(lock)) if (!known.has(k)) out.push(`unexpected key ${k}`);
  return out;
}

export function releaseAssets(version) {
  return [`Open-Agent-${version}-arm64.dmg`, `Open-Agent-${version}-x64.dmg`, MANIFEST_NAME, SUMS_NAME].sort();
}

export const summedFiles = (version) => releaseAssets(version).filter((n) => n !== SUMS_NAME);

export function sha256sums(files) {
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return sorted.map((f) => `${f.sha256}  ${f.name}\n`).join("");
}

export function parseSums(text) {
  const out = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const m = /^([0-9a-f]{64}) {2}([^/\s][^/]*)$/.exec(line);
    if (!m) throw new Error(`bad SHA256SUMS line ${JSON.stringify(line)}`);
    out.push({ sha256: m[1], name: m[2] });
  }
  return out;
}

export function previousFinalTag(tags, tag) {
  const own = FINAL_TAG.exec(tag) ?? RELEASE_TAG.exec(tag) ?? DRY_RUN_TAG.exec(tag);
  if (!own) return undefined;
  const me = own[1];
  let best;
  for (const t of tags) {
    const m = FINAL_TAG.exec(t);
    if (!m || t === tag) continue;
    if (compareSemver(m[1], me) >= 0) continue;
    if (!best || compareSemver(m[1], best[1]) > 0) best = m;
  }
  return best?.[0];
}

export function attestationVerifyLine(subject, version) {
  return `gh attestation verify ${subject} --repo ${REPO_SLUG} --signer-workflow ${SIGNER_WORKFLOW} --source-ref refs/tags/v${version} --deny-self-hosted-runners`;
}

export function notes({ version, prerelease, digests, bases, changes, previousTag }) {
  const tag = `v${version}`;
  const lines = [
    `# Open Agent ${version}`,
    "",
    "Open Agent is a research and planning agent that runs on your computer: chat, widgets and reports, with your own model keys or a local model.",
    "",
  ];
  if (prerelease)
    lines.push(
      `> This is a release candidate (prerelease) for testing. It is never offered as an update and is not supported; use the latest final release instead.`,
      "",
    );
  lines.push(
    "## Install on a Mac",
    "",
    `- Apple silicon (M1 and later): \`Open-Agent-${version}-arm64.dmg\``,
    `- Intel: \`Open-Agent-${version}-x64.dmg\``,
    "",
    "You need Docker (Docker Desktop, OrbStack or Colima). Open the DMG and drag Open Agent to Applications.",
    'The app is not signed with an Apple Developer ID, so macOS blocks the first open: use System Settings → Privacy & Security → "Open Anyway", or run:',
    "",
    "```bash",
    'xattr -dr com.apple.quarantine "/Applications/Open Agent.app"',
    "```",
    "",
    `Full guide: https://github.com/${REPO_SLUG}/blob/${tag}/docs/INSTALL.md`,
    "",
    "## No Mac app (any OS with Docker)",
    "",
    "```bash",
    `git clone --branch ${tag} --depth 1 https://github.com/${REPO_SLUG} && cd open-agent-bot`,
    `printf 'OPEN_AGENT_IMAGE=${digests.agent}\\nOPEN_AGENT_SEARCH_IMAGE=${digests.search}\\n' > .env`,
    "docker compose pull agent search && docker compose up -d --no-build",
    "```",
    "",
    "Then open http://127.0.0.1:3000. To build from source instead, run `docker compose up -d --build` in the clone.",
    "",
    "## Images (pinned by digest)",
    "",
    `- agent: \`${digests.agent}\``,
    `- search: \`${digests.search}\``,
    "",
    "```bash",
    attestationVerifyLine(`oci://${digests.agent}`, version),
    attestationVerifyLine(`oci://${digests.search}`, version),
    "```",
    "",
    "Base images:",
    "",
    `- agent: \`${bases.agent}\``,
    `- search: \`${bases.search}\``,
    "",
    "## Verify your download",
    "",
    "`SHA256SUMS` only catches a broken or incomplete download (it sits next to the files it lists, so it proves nothing about who made them):",
    "",
    "```bash",
    "shasum -a 256 -c SHA256SUMS --ignore-missing",
    "```",
    "",
    "The attestation proves the file was built by this repository's release workflow at this tag (authenticity). It needs a current, signed-in `gh`:",
    "",
    "```bash",
    attestationVerifyLine(`Open-Agent-${version}-arm64.dmg`, version),
    "```",
    "",
    `## Changes${previousTag ? ` since ${previousTag}` : ""}`,
    "",
    ...(changes.length ? changes.map((c) => `- ${c}`) : ["- (no commits)"]),
    "",
  );
  return lines.join("\n");
}

export function baseImages(agentDockerfile, searchDockerfile) {
  const from = (text) => [...text.matchAll(/^FROM\s+(?:--platform=\S+\s+)?(\S+)/gm)].map((m) => m[1]);
  const agent = [...new Set(from(agentDockerfile))];
  const search = [...new Set(from(searchDockerfile))];
  const problems = [];
  if (agent.length !== 1 || !/^mcr\.microsoft\.com\/playwright:v[\d.]+-noble@sha256:[0-9a-f]{64}$/.test(agent[0] ?? ""))
    problems.push(`the agent Dockerfile must use one digest-pinned Playwright base, got ${agent.join(", ")}`);
  if (search.length !== 1 || !/@sha256:[0-9a-f]{64}$/.test(search[0] ?? ""))
    problems.push(`the search Dockerfile must use one digest-pinned base, got ${search.join(", ")}`);
  if (problems.length) throw new Error(problems.join("; "));
  return { agent: agent[0], search: search[0] };
}

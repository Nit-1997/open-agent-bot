import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { RELEASE_IMAGES } from "../release/releaseLib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const RELEASE = ".github/workflows/release.yml";
const has = existsSync(join(ROOT, RELEASE));
const wf = has ? parse(read(RELEASE)) : { jobs: {} };
const LOCKFILE = JSON.parse(read("package-lock.json"));

const JOBS = ["gate", "push", "merge", "lock", "desktop", "verify-dmgs", "attest", "release"];
const WRITE_JOBS = ["push", "merge", "attest", "release"];
const PERMISSIONS = {
  gate: { contents: "read" },
  push: { contents: "read", packages: "write", "id-token": "write", attestations: "write" },
  merge: { contents: "read", packages: "write", "id-token": "write", attestations: "write" },
  lock: { contents: "read", packages: "read", attestations: "read" },
  desktop: { contents: "read" },
  "verify-dmgs": { contents: "read" },
  attest: { contents: "read", "id-token": "write", attestations: "write" },
  release: { contents: "write" },
};
const RUNNERS = {
  gate: "ubuntu-24.04",
  merge: "ubuntu-24.04",
  lock: "ubuntu-24.04",
  desktop: "macos-15",
  "verify-dmgs": "macos-15",
  attest: "ubuntu-24.04",
  release: "ubuntu-24.04",
};
const NEEDS = {
  push: ["gate"],
  merge: ["gate", "push"],
  lock: ["gate", "merge"],
  desktop: ["gate", "lock"],
  "verify-dmgs": ["gate", "lock", "desktop"],
  attest: ["gate", "verify-dmgs"],
  release: ["gate", "attest"],
};

const VERIFY_DMGS_RUN = `want="$(shasum -a 256 "$LOCK" | cut -d ' ' -f 1)"
echo "release-lock services.lock.json sha256 $want"
for arch in arm64 x64; do
  dmg="$DMGS/Open-Agent-$VERSION-$arch.dmg"
  mnt="$RUNNER_TEMP/m-$arch"
  hdiutil attach -nobrowse -readonly -mountpoint "$mnt" "$dmg"
  apps="$(find "$mnt" -mindepth 1 -maxdepth 1 -name '*.app' | wc -l | tr -d ' ')"
  echo "$arch: $apps app bundle(s) in the DMG"
  test "$apps" = 1
  app="$mnt/Open Agent.app"
  test -d "$app"
  test ! -L "$app"
  lock="$app/Contents/Resources/stack/services.lock.json"
  test -f "$lock"
  test ! -L "$lock"
  got="$(shasum -a 256 "$lock" | cut -d ' ' -f 1)"
  echo "$arch: bundled services.lock.json sha256 $got"
  test "$got" = "$want"
  short="$(plutil -extract CFBundleShortVersionString raw "$app/Contents/Info.plist")"
  echo "$arch: CFBundleShortVersionString $short"
  test "$short" = "$VERSION"
  hdiutil detach "$mnt"
done
`;
const SUMS_RUN = `sha256sum "Open-Agent-$VERSION-arm64.dmg" "Open-Agent-$VERSION-x64.dmg" open-agent-services.json > SHA256SUMS\n`;
const RELEASE_EXISTING_RUN = `gh api "repos/$GITHUB_REPOSITORY/releases" --paginate --jq '.[] | select(.tag_name == env.TAG) | .id' > "$RUNNER_TEMP/existing-releases.txt"
cat "$RUNNER_TEMP/existing-releases.txt"
test ! -s "$RUNNER_TEMP/existing-releases.txt"
`;
const RELEASE_VIEW_RUN = `gh release view "$TAG" --repo "$GITHUB_REPOSITORY" --json isDraft,assets --jq '.isDraft == true and ([.assets[].name] | sort) == ([env.ASSET_ARM64, env.ASSET_X64, env.ASSET_MANIFEST, env.ASSET_SUMS] | sort)' > "$RUNNER_TEMP/draft-check.txt"
cat "$RUNNER_TEMP/draft-check.txt"
grep -qx true "$RUNNER_TEMP/draft-check.txt"
`;
const SMOKE_RUN = `node apps/desktop/scripts/packagedSmoke.mjs --release "$VERSION" --expect-lock "$RUNNER_TEMP/release-lock/services.lock.json" --app "apps/desktop/release/mac-arm64/Open Agent.app" --app "apps/desktop/release/mac/Open Agent.app" --dmg "apps/desktop/release/Open-Agent-$VERSION-arm64.dmg" --dmg "apps/desktop/release/Open-Agent-$VERSION-x64.dmg"`;
const ROSETTA_RUN = "/usr/bin/pgrep -q oahd || sudo softwareupdate --install-rosetta --agree-to-license\n";
const PINNED = {
  "verify-dmgs": [VERIFY_DMGS_RUN],
  attest: [SUMS_RUN],
  release: [RELEASE_EXISTING_RUN, RELEASE_VIEW_RUN],
  desktop: [ROSETTA_RUN],
};

const DESKTOP_NPM = [
  /^npm ci --ignore-scripts$/,
  /^npm run postinstall$/,
  /^npm run electron:install -w @oab\/desktop$/,
  /^npm rebuild [@a-z0-9/._-]+$/,
];
const DESKTOP_NODE = [
  /^node apps\/desktop\/scripts\/stage-stack\.mjs --lock "\$RUNNER_TEMP\/release-lock\/services\.lock\.json"$/,
  /^node apps\/desktop\/scripts\/build\.mjs$/,
  /^\.\.\/\.\.\/node_modules\/\.bin\/electron-builder --mac --arm64 --x64 --publish never --config\.extraMetadata\.version="\$VERSION"$/,
];
const DESKTOP_EXACT = [SMOKE_RUN];
const SIMPLE = [/^node scripts\/release\/[a-z-]+\.mjs(?: |$)/, /^gh (?!release (?:edit|delete|upload))/, /^docker /];
const GATE_FETCH = 'git fetch --force origin "+refs/tags/$TAG:refs/tags/$TAG"';

const jobs = () => wf.jobs ?? {};
const job = (n) => jobs()[n] ?? { steps: [] };
const steps = (n) => job(n).steps ?? [];
const runsOf = (n) => steps(n).filter((s) => typeof s.run === "string");
const usesOf = (n, prefix) => steps(n).filter((s) => String(s.uses ?? "").startsWith(prefix));
const at = (n, pred) => steps(n).findIndex(pred);
const runAt = (n, re) => at(n, (s) => re.test(s.run ?? ""));
const needsOf = (n) => [job(n).needs ?? []].flat();
const envName = (j) => (typeof j.environment === "string" ? j.environment : j.environment?.name);
const allSteps = () => Object.keys(jobs()).flatMap((n) => steps(n).map((s) => ({ job: n, step: s })));

function runProblems(jobName, run) {
  const text = run.endsWith("\n") ? run : `${run}\n`;
  if ((PINNED[jobName] ?? []).includes(text)) return [];
  const line = run.trim();
  if (line.includes("\n")) return [`${jobName}: a run step must be one command, got ${JSON.stringify(run)}`];
  if (/[|;&`]|\$\(/.test(line.replace(/'[^']*'/g, "''"))) return [`${jobName}: inline shell logic in ${JSON.stringify(line)}`];
  if (jobName === "gate" && line === GATE_FETCH) return [];
  if (jobName === "desktop" && ([...DESKTOP_NPM, ...DESKTOP_NODE].some((re) => re.test(line)) || DESKTOP_EXACT.includes(line))) return [];
  if (SIMPLE.some((re) => re.test(line))) return [];
  return [`${jobName}: ${JSON.stringify(line)} is not a scripts/release call, a gh/docker invocation or an allowed desktop npm command`];
}

function npmProblems(run) {
  const out = [];
  for (const raw of run.split("\n")) {
    const line = raw.trim();
    if (/(^|\s)npm (install|i|add)(\s|$)/.test(line)) out.push(`npm install is not allowed: ${line}`);
    if (/(^|\s)npm rebuild\s*$/.test(line)) out.push(`a bare npm rebuild is not allowed: ${line}`);
    if (/(^|\s)npm ci(?!\s+--ignore-scripts)(\s|$)/.test(line)) out.push(`npm ci must pass --ignore-scripts: ${line}`);
    for (const m of line.matchAll(/(?:^|\s)npx\s+(?:--?[\w-]+\s+)*(\S+)/g)) {
      const spec = m[1];
      const at = spec.lastIndexOf("@");
      const name = at > 0 ? spec.slice(0, at) : spec;
      const version = at > 0 ? spec.slice(at + 1) : undefined;
      const entry = LOCKFILE.packages?.[`node_modules/${name}`];
      if (!version || !entry || entry.version !== version) out.push(`npx ${spec} is not an exact-version lockfile entry`);
    }
  }
  return out;
}

describe("release workflow rule helpers", () => {
  it("npmProblems refuses npm install, a bare npm rebuild, npm ci without --ignore-scripts and an unpinned npx", () => {
    assert.equal(npmProblems("npm install").length, 1);
    assert.equal(npmProblems("npm i esbuild").length, 1);
    assert.equal(npmProblems("npm rebuild").length, 1);
    assert.equal(npmProblems("npm ci").length, 1);
    assert.equal(npmProblems("npx electron-builder --mac").length, 1);
    assert.equal(npmProblems("npx left-pad@1.0.0").length, 1);
    assert.deepEqual(npmProblems("npm ci --ignore-scripts"), []);
    assert.deepEqual(npmProblems("npm rebuild esbuild"), []);
    assert.deepEqual(npmProblems(`npx electron-builder@${LOCKFILE.packages["node_modules/electron-builder"].version} --mac`), []);
  });

  it("runProblems refuses inline logic and unknown commands, accepts one script/gh/docker call", () => {
    assert.deepEqual(runProblems("lock", 'node scripts/release/write-lock.mjs --version "$VERSION"'), []);
    assert.deepEqual(runProblems("lock", 'docker buildx imagetools inspect "$AGENT" --raw > "$OUT/raw-agent.json"'), []);
    assert.equal(runProblems("lock", 'echo "x" >> "$GITHUB_OUTPUT"').length, 1);
    assert.equal(runProblems("lock", "node scripts/release/a.mjs && rm -rf /").length, 1);
    assert.equal(runProblems("lock", 'test -z "$(docker ps)"').length, 1);
    assert.equal(runProblems("lock", "node scripts/release/a.mjs\nnode scripts/release/b.mjs").length, 1);
    assert.equal(runProblems("release", 'gh release edit "$TAG" --draft=false').length, 1);
    assert.equal(runProblems("desktop", "npm install").length, 1);
    assert.deepEqual(runProblems("desktop", "npm rebuild esbuild"), []);
  });
});

describe("release.yml triggers and shape (AC 1)", () => {
  it("release.yml replaces images.yml", () => {
    assert.ok(has, RELEASE);
    assert.equal(existsSync(join(ROOT, ".github/workflows/images.yml")), false);
    assert.equal(wf.name, "Release");
  });

  it("runs only on pushed v* tags", () => {
    assert.deepEqual(wf.on, { push: { tags: ["v*"] } });
    for (const t of ["pull_request", "pull_request_target", "workflow_dispatch", "workflow_run", "schedule", "repository_dispatch"])
      assert.equal(read(RELEASE).includes(`${t}:`), false, t);
  });

  it("has exactly the eight jobs and never cancels a running release", () => {
    assert.deepEqual(Object.keys(jobs()), JOBS);
    assert.deepEqual(wf.concurrency, { group: `release-\${{ github.ref }}`, "cancel-in-progress": false });
    assert.deepEqual(wf.defaults, { run: { shell: "bash" } });
  });

  it("gate is guarded by repository, event and ref type", () => {
    const cond = String(job("gate").if ?? "");
    for (const piece of ["github.repository == 'Nit-1997/open-agent-bot'", "github.event_name == 'push'", "github.ref_type == 'tag'"])
      assert.ok(cond.includes(piece), piece);
  });

  it("gate fetches the tag object, then runs gate.mjs, and outputs version/prerelease/tag", () => {
    const checkout = usesOf("gate", "actions/checkout@")[0];
    assert.equal(checkout.with["fetch-depth"], 0);
    const fetch = at("gate", (s) => s.run?.trim() === GATE_FETCH);
    const gate = runAt("gate", /^node scripts\/release\/gate\.mjs --tag "\$TAG"$/);
    assert.ok(fetch >= 0 && gate > fetch, `fetch ${fetch} gate ${gate}`);
    assert.equal(steps("gate")[fetch].env.TAG, `\${{ github.ref_name }}`);
    assert.equal(steps("gate")[gate].env.TAG, `\${{ github.ref_name }}`);
    assert.equal(steps("gate")[gate].env.GH_TOKEN, `\${{ github.token }}`);
    assert.equal(steps("gate")[gate].id, "gate");
    assert.deepEqual(job("gate").outputs, {
      version: `\${{ steps.gate.outputs.version }}`,
      prerelease: `\${{ steps.gate.outputs.prerelease }}`,
      tag: `\${{ steps.gate.outputs.tag }}`,
    });
  });

  it("every other job reaches gate through needs, in the D2 order", () => {
    for (const [n, want] of Object.entries(NEEDS)) assert.deepEqual(needsOf(n), want, n);
    const reaches = (n, seen = new Set()) => needsOf(n).some((d) => d === "gate" || (!seen.has(d) && reaches(d, seen.add(d))));
    for (const n of JOBS.filter((j) => j !== "gate")) assert.ok(reaches(n), n);
  });
});

describe("least privilege (AC 2)", () => {
  it("top level is contents: read", () => assert.deepEqual(wf.permissions, { contents: "read" }));

  for (const n of JOBS) {
    it(`${n}: permissions are exactly the D2 table`, () => assert.deepEqual(job(n).permissions, PERMISSIONS[n]));
    it(`${n}: environment release only on the write jobs`, () =>
      assert.equal(envName(job(n)), WRITE_JOBS.includes(n) ? "release" : undefined));
  }

  it("contents: write only on release; packages: write only on push and merge; id-token/attestations: write only on push, merge, attest", () => {
    const withScope = (scope) => JOBS.filter((n) => job(n).permissions?.[scope] === "write");
    assert.deepEqual(withScope("contents"), ["release"]);
    assert.deepEqual(withScope("packages"), ["push", "merge"]);
    assert.deepEqual(withScope("id-token"), ["push", "merge", "attest"]);
    assert.deepEqual(withScope("attestations"), ["push", "merge", "attest"]);
  });

  it("runs on the D2 runners; push builds natively on amd64 and arm64", () => {
    for (const [n, r] of Object.entries(RUNNERS)) assert.equal(job(n)["runs-on"], r, n);
    assert.equal(job("push")["runs-on"], `\${{ matrix.runner }}`);
    const legs = job("push")
      .strategy.matrix.include.map((l) => `${l.image} ${l.arch} ${l.platform} ${l.runner}`)
      .sort();
    assert.deepEqual(legs, [
      "open-agent amd64 linux/amd64 ubuntu-24.04",
      "open-agent arm64 linux/arm64 ubuntu-24.04-arm",
      "open-agent-search amd64 linux/amd64 ubuntu-24.04",
      "open-agent-search arm64 linux/arm64 ubuntu-24.04-arm",
    ]);
  });

  it("every job has a timeout", () => {
    for (const n of JOBS) assert.ok(Number(job(n)["timeout-minutes"]) > 0, n);
  });

  it("every checkout sets persist-credentials: false; verify-dmgs, attest and release have no checkout", () => {
    const checkouts = allSteps().filter(({ step }) => String(step.uses ?? "").startsWith("actions/checkout@"));
    assert.ok(checkouts.length >= 5);
    for (const { job: n, step } of checkouts) assert.equal(step.with?.["persist-credentials"], false, n);
    for (const n of ["verify-dmgs", "attest", "release"]) assert.equal(usesOf(n, "actions/checkout@").length, 0, n);
  });

  it("no run: contains ${{ (expressions go through env:)", () => {
    for (const { job: n, step } of allSteps()) if (step.run) assert.equal(step.run.includes("${{"), false, `${n}: ${step.run}`);
  });

  it("setup-node never restores a cache in the release workflow", () => {
    for (const { job: n, step } of allSteps())
      if (String(step.uses ?? "").startsWith("actions/setup-node@")) {
        assert.equal(step.with?.cache, undefined, n);
        assert.equal(step.with?.["node-version-file"], ".nvmrc", n);
      }
  });
});

describe("no inline release logic (AC 31)", () => {
  it("every run: outside the pinned verify-dmgs/attest/release/desktop lines is one scripts/release call, a gh/docker invocation or a desktop npm command", () => {
    for (const { job: n, step } of allSteps()) if (step.run) assert.deepEqual(runProblems(n, step.run), [], `${n}: ${step.run}`);
  });

  it("no npm install, bare npm rebuild, npm ci without --ignore-scripts or unpinned npx anywhere", () => {
    for (const { job: n, step } of allSteps()) if (step.run) assert.deepEqual(npmProblems(step.run), [], n);
  });

  it("only the desktop job runs npm", () => {
    for (const { job: n, step } of allSteps()) if (n !== "desktop" && step.run) assert.doesNotMatch(step.run, /(^|\s)(npm|npx)\s/, n);
  });

  it("the workflow never passes --dry-run to a release script", () => assert.equal(read(RELEASE).includes("--dry-run"), false));
});

describe("push: build, check, push the same build, check again, attest (AC 4, 31)", () => {
  const builds = () => usesOf("push", "docker/build-push-action@");
  const BUILD_ARGS = `OPEN_AGENT_VERSION=\${{ needs.gate.outputs.version }}\nOPEN_AGENT_REVISION=\${{ github.sha }}`;

  it("two build steps with the same inputs, version from gate, no GHA cache anywhere", () => {
    assert.equal(builds().length, 2);
    const [check, pushed] = builds();
    for (const k of ["context", "file", "platforms"]) assert.equal(check.with[k], pushed.with[k], k);
    for (const s of builds()) {
      assert.equal(String(s.with["build-args"]).trim(), BUILD_ARGS);
      assert.equal(s.with["cache-from"], undefined);
      assert.equal(s.with["cache-to"], undefined);
      assert.equal(JSON.stringify(s.with).includes("secrets."), false);
    }
    assert.equal(read(RELEASE).includes("type=gha"), false);
    assert.equal(read(RELEASE).includes("REF_NAME"), false);
  });

  it("the first build has no cache at all and only loads; the second pushes it by digest with provenance and an SBOM", () => {
    const [check, pushed] = builds();
    assert.equal(check.with["no-cache"], true);
    assert.equal(check.with.load, true);
    assert.equal(check.with.push, false);
    assert.equal(check.with.tags, `\${{ matrix.image }}:check`);
    assert.equal(pushed.id, "build");
    assert.equal(pushed.with.outputs, `type=image,name=\${{ matrix.name }},push-by-digest=true,name-canonical=true,push=true`);
    assert.equal(pushed.with.provenance, "mode=max");
    assert.equal(pushed.with.sbom, true);
    for (const l of job("push").strategy.matrix.include) assert.equal(l.name, `ghcr.io/nit-1997/${l.image}`, `${l.image} ${l.arch}`);
  });

  it("the push and merge matrices are releaseLib's RELEASE_IMAGES table (one table for build inputs)", () => {
    const want = RELEASE_IMAGES.flatMap((i) =>
      ["amd64", "arm64"].map((arch) => ({
        image: i.image,
        name: i.name,
        arch,
        context: i.context,
        dockerfile: i.dockerfile,
        content: i.content,
      })),
    );
    const got = job("push").strategy.matrix.include.map(({ image, name, arch, context, dockerfile, content }) => ({
      image,
      name,
      arch,
      context,
      dockerfile,
      content,
    }));
    assert.deepEqual(got, want);
    assert.deepEqual(
      job("merge").strategy.matrix.include,
      RELEASE_IMAGES.map((i) => ({ image: i.image, name: i.name })),
    );
  });

  it("content and labels before the push; pull, content again, attest, record after", () => {
    const [check, pushed] = builds();
    const i = (s) => steps("push").indexOf(s);
    const contentBefore = runAt("push", /^node scripts\/release\/image-checks\.mjs content --image "\$IMAGE" --dir "\$CONTENT_DIR"$/);
    const labels = runAt(
      "push",
      /^node scripts\/release\/image-checks\.mjs labels --image "\$IMAGE" --version "\$VERSION" --revision "\$GITHUB_SHA"$/,
    );
    const pull = runAt("push", /^docker pull --quiet "\$IMAGE"$/);
    const contentAfter = steps("push").findIndex(
      (s, k) => k > pull && /^node scripts\/release\/image-checks\.mjs content --image "\$IMAGE" --dir "\$CONTENT_DIR"$/.test(s.run ?? ""),
    );
    const attest = at("push", (s) => String(s.uses ?? "").startsWith("actions/attest-build-provenance@"));
    const record = runAt(
      "push",
      /^node scripts\/release\/refs\.mjs record --arch "\$ARCH" --digest "\$DIGEST" --dir "\$RUNNER_TEMP\/digests"$/,
    );
    const upload = at("push", (s) => String(s.uses ?? "").startsWith("actions/upload-artifact@"));
    const order = [i(check), contentBefore, labels, i(pushed), pull, contentAfter, attest, record, upload];
    assert.deepEqual(
      [...order].sort((a, b) => a - b),
      order,
      order.join(","),
    );
    assert.ok(
      order.every((k) => k >= 0),
      order.join(","),
    );
    assert.equal(steps("push")[contentBefore].env.IMAGE, `\${{ matrix.image }}:check`);
    assert.equal(steps("push")[labels].env.IMAGE, `\${{ matrix.image }}:check`);
    assert.equal(steps("push")[labels].env.VERSION, `\${{ needs.gate.outputs.version }}`);
    const digestRef = `\${{ matrix.name }}@\${{ steps.build.outputs.digest }}`;
    assert.equal(steps("push")[pull].env.IMAGE, digestRef);
    assert.equal(steps("push")[contentAfter].env.IMAGE, digestRef);
    assert.deepEqual(steps("push")[attest].with, {
      "subject-name": `\${{ matrix.name }}`,
      "subject-digest": `\${{ steps.build.outputs.digest }}`,
      "push-to-registry": true,
    });
    assert.equal(steps("push")[upload].with.name, `digests-\${{ matrix.image }}-\${{ matrix.arch }}`);
    assert.equal(Number(steps("push")[upload].with["retention-days"]), 1);
  });
});

describe("merge: index tags :<version> and :sha-<7> via scripts (AC 4)", () => {
  it("computes the inputs with refs.mjs, creates the index with --metadata-file, reads the digest with merge-digest, attests it", () => {
    const download = usesOf("merge", "actions/download-artifact@")[0];
    assert.equal(download.with.pattern, `digests-\${{ matrix.image }}-*`);
    assert.equal(download.with["merge-multiple"], true);
    const inputs = runAt(
      "merge",
      /^node scripts\/release\/refs\.mjs merge-inputs --dir "\$RUNNER_TEMP\/digests" --name "\$NAME" --version "\$VERSION" --sha "\$GITHUB_SHA"$/,
    );
    const create = runAt(
      "merge",
      /^docker buildx imagetools create --metadata-file "\$RUNNER_TEMP\/index-metadata\.json" -t "\$VERSION_TAG" -t "\$SHA_TAG" "\$AMD64" "\$ARM64"$/,
    );
    const digest = runAt(
      "merge",
      /^node scripts\/release\/image-checks\.mjs merge-digest --metadata "\$RUNNER_TEMP\/index-metadata\.json" --name "\$NAME" --out "\$RUNNER_TEMP\/index\/\$IMAGE\.json"$/,
    );
    const attest = at("merge", (s) => String(s.uses ?? "").startsWith("actions/attest-build-provenance@"));
    const upload = at("merge", (s) => String(s.uses ?? "").startsWith("actions/upload-artifact@"));
    assert.ok(
      inputs >= 0 && create > inputs && digest > create && attest > digest && upload > attest,
      [inputs, create, digest, attest, upload].join(),
    );
    const s = steps("merge");
    assert.equal(s[inputs].id, "inputs");
    assert.equal(s[inputs].env.VERSION, `\${{ needs.gate.outputs.version }}`);
    assert.equal(s[create].env.VERSION_TAG, `\${{ steps.inputs.outputs.version_tag }}`);
    assert.equal(s[create].env.SHA_TAG, `\${{ steps.inputs.outputs.sha_tag }}`);
    assert.equal(s[digest].id, "merge");
    assert.deepEqual(s[attest].with, {
      "subject-name": `\${{ matrix.name }}`,
      "subject-digest": `\${{ steps.merge.outputs.digest }}`,
      "push-to-registry": true,
    });
    assert.equal(s[upload].with.name, `index-\${{ matrix.image }}`);
    assert.equal(s[upload].with.path, `\${{ runner.temp }}/index/\${{ matrix.image }}.json`);
    assert.equal(read(RELEASE).includes(":latest"), false);
  });
});

describe("lock: verified index, pinned attestation checks before the lock (AC 5, 7)", () => {
  const VERIFY = (svc) =>
    new RegExp(
      `^gh attestation verify "oci://\\$${svc}" --repo Nit-1997/open-agent-bot --signer-workflow Nit-1997/open-agent-bot/\\.github/workflows/release\\.yml --source-ref "refs/tags/\\$TAG" --source-digest "\\$GITHUB_SHA" --deny-self-hosted-runners --format json > "\\$RUNNER_TEMP/attestation-${svc.toLowerCase()}\\.json"$`,
    );

  it("checks out full history, reads index-* artifacts and logs in read-only", () => {
    assert.equal(usesOf("lock", "actions/checkout@")[0].with["fetch-depth"], 0);
    const download = usesOf("lock", "actions/download-artifact@")[0];
    assert.equal(download.with.pattern, "index-*");
    assert.equal(download.with["merge-multiple"], true);
    assert.equal(usesOf("lock", "docker/login-action@").length, 1);
    const qemu = usesOf("lock", "docker/setup-qemu-action@")[0];
    assert.match(String(qemu.with.image), /^tonistiigi\/binfmt:qemu-v[\d.]+@sha256:[0-9a-f]{64}$/);
  });

  it("raw index, tag digest and verify-index for both images, then Node 24 on both platforms and the labels", () => {
    for (const svc of ["agent", "search"]) {
      const S = svc.toUpperCase();
      const raw = runAt(
        "lock",
        new RegExp(`^docker buildx imagetools inspect "\\$${S}" --raw > "\\$RUNNER_TEMP/release-lock/raw-${svc}\\.json"$`),
      );
      const tag = runAt(
        "lock",
        new RegExp(
          `^docker buildx imagetools inspect "\\$${S}_TAG" --format '\\{\\{json \\.Manifest\\}\\}' > "\\$RUNNER_TEMP/tag-${svc}\\.json"$`,
        ),
      );
      const td = runAt(
        "lock",
        new RegExp(`^node scripts/release/image-checks\\.mjs merge-digest --inspect "\\$RUNNER_TEMP/tag-${svc}\\.json"$`),
      );
      const vi = runAt(
        "lock",
        new RegExp(
          `^node scripts/release/verify-index\\.mjs --ref "\\$${S}" --version "\\$VERSION" --raw "\\$RUNNER_TEMP/release-lock/raw-${svc}\\.json" --tag-digest "\\$TAG_DIGEST"$`,
        ),
      );
      assert.ok(raw >= 0 && tag > raw && td > tag && vi > td, `${svc}: ${[raw, tag, td, vi]}`);
      assert.equal(steps("lock")[td].id, `tag-${svc}`);
      assert.equal(steps("lock")[vi].env.TAG_DIGEST, `\${{ steps.tag-${svc}.outputs.digest }}`);
      assert.ok(
        runAt(
          "lock",
          new RegExp(
            `^node scripts/release/image-checks\\.mjs labels --image "\\$${S}" --version "\\$VERSION" --revision "\\$GITHUB_SHA" --pull --platform linux/amd64$`,
          ),
        ) >= 0,
        `labels ${svc}`,
      );
    }
    for (const p of ["linux/amd64", "linux/arm64"])
      assert.ok(runAt("lock", new RegExp(`^node scripts/release/image-checks\\.mjs node --image "\\$AGENT" --platform ${p}$`)) >= 0, p);
  });

  it("both gh attestation verify steps pin the signer, ref, commit and hosted runners, and run before write-lock --attested and assert-lock --attested", () => {
    const vAgent = runAt("lock", VERIFY("AGENT"));
    const vSearch = runAt("lock", VERIFY("SEARCH"));
    const lastIndex = Math.max(...["agent", "search"].map((s) => runAt("lock", new RegExp(`verify-index\\.mjs .*raw-${s}`))));
    const attested = runAt(
      "lock",
      /^node scripts\/release\/attested\.mjs --tag "\$TAG" --sha "\$GITHUB_SHA" --agent "\$AGENT" --search "\$SEARCH" --agent-result "\$RUNNER_TEMP\/attestation-agent\.json" --search-result "\$RUNNER_TEMP\/attestation-search\.json" --out "\$RUNNER_TEMP\/release-lock\/attested\.json"$/,
    );
    const write = runAt(
      "lock",
      /^node scripts\/release\/write-lock\.mjs --version "\$VERSION" --agent "\$AGENT" --search "\$SEARCH" --out-lock "\$RUNNER_TEMP\/release-lock\/services\.lock\.json" --out-manifest "\$RUNNER_TEMP\/release-lock\/open-agent-services\.json" --attested "\$RUNNER_TEMP\/release-lock\/attested\.json"$/,
    );
    const assertLock = runAt(
      "lock",
      /^node scripts\/release\/assert-lock\.mjs "\$RUNNER_TEMP\/release-lock\/services\.lock\.json" --version "\$VERSION" --attested "\$RUNNER_TEMP\/release-lock\/attested\.json"$/,
    );
    const notes = runAt(
      "lock",
      /^node scripts\/release\/notes\.mjs --version "\$VERSION" --lock "\$RUNNER_TEMP\/release-lock\/services\.lock\.json" --out "\$RUNNER_TEMP\/release-lock\/notes\.md" --ref "\$GITHUB_SHA"$/,
    );
    const order = [lastIndex, vAgent, vSearch, attested, write, assertLock, notes];
    assert.ok(
      order.every((k) => k >= 0),
      order.join(),
    );
    assert.deepEqual(
      [...order].sort((a, b) => a - b),
      order,
      order.join(),
    );
    for (const k of [vAgent, vSearch]) assert.equal(steps("lock")[k].env.GH_TOKEN, `\${{ github.token }}`);
  });

  it("refs come from refs.mjs lock-inputs; every step that names an image reads it from that step's outputs", () => {
    const k = runAt(
      "lock",
      /^node scripts\/release\/refs\.mjs lock-inputs --dir "\$RUNNER_TEMP\/index" --version "\$VERSION" --out-dir "\$RUNNER_TEMP\/release-lock"$/,
    );
    assert.ok(k >= 0);
    assert.equal(steps("lock")[k].id, "refs");
    assert.deepEqual(job("lock").env, { VERSION: `\${{ needs.gate.outputs.version }}`, TAG: `\${{ needs.gate.outputs.tag }}` });
    const OUTPUT = { AGENT: "agent", SEARCH: "search", AGENT_TAG: "agent_tag", SEARCH_TAG: "search_tag" };
    for (const s of runsOf("lock"))
      for (const [v, o] of Object.entries(OUTPUT))
        if (new RegExp(`"\\$${v}"`).test(s.run)) assert.equal(s.env?.[v], `\${{ steps.refs.outputs.${o} }}`, `${v} in ${s.run}`);
  });

  it("uploads release-lock from the lock dir (lock, manifest, attested, notes, raw)", () => {
    const up = usesOf("lock", "actions/upload-artifact@");
    assert.equal(up.length, 1);
    assert.equal(up[0].with.name, "release-lock");
    assert.equal(up[0].with.path, `\${{ runner.temp }}/release-lock`);
    assert.equal(up[0].with["if-no-files-found"], "error");
  });
});

describe("desktop: DMGs from the release lock with npm ci --ignore-scripts (AC 10, 28, 31)", () => {
  const lines = () => runsOf("desktop").map((s) => s.run.trim());

  it("installs with npm ci --ignore-scripts first, then the explicit postinstall and Electron download", () => {
    const l = lines();
    const ci = l.indexOf("npm ci --ignore-scripts");
    assert.ok(ci >= 0);
    assert.ok(l.indexOf("npm run postinstall") > ci);
    assert.ok(l.indexOf("npm run electron:install -w @oab/desktop") > ci);
    for (const x of l.filter((x) => x.startsWith("npm rebuild"))) assert.match(x, /^npm rebuild [@a-z0-9/._-]+$/);
  });

  it("stages the release-lock lock, builds, runs electron-builder with the version and smokes with --release and --expect-lock", () => {
    const download = usesOf("desktop", "actions/download-artifact@");
    assert.deepEqual(
      download.map((d) => [d.with.name, d.with.path]),
      [["release-lock", `\${{ runner.temp }}/release-lock`]],
    );
    const stage = runAt("desktop", /stage-stack\.mjs --lock "\$RUNNER_TEMP\/release-lock\/services\.lock\.json"/);
    const build = runAt("desktop", /^node apps\/desktop\/scripts\/build\.mjs$/);
    const eb = runAt("desktop", /electron-builder --mac --arm64 --x64 --publish never --config\.extraMetadata\.version="\$VERSION"/);
    const smoke = at("desktop", (s) => s.run === SMOKE_RUN);
    const upload = at("desktop", (s) => String(s.uses ?? "").startsWith("actions/upload-artifact@"));
    const order = [stage, build, eb, smoke, upload];
    assert.ok(
      order.every((k) => k >= 0),
      order.join(),
    );
    assert.deepEqual(
      [...order].sort((a, b) => a - b),
      order,
      order.join(),
    );
    assert.equal(String(steps("desktop")[eb].env.CSC_IDENTITY_AUTO_DISCOVERY), "false");
    assert.equal(steps("desktop")[eb]["working-directory"], "apps/desktop");
  });

  it("leaves the kind/version check to packagedSmoke (no second grep over its log)", () => {
    for (const s of runsOf("desktop")) {
      assert.doesNotMatch(s.run, /smoke\.log|\bgrep -c\b|\btee\b/, s.run);
    }
    assert.match(read("apps/desktop/scripts/packagedSmokeLib.mjs"), /not byte-equal to --expect-lock/);
  });

  it("uploads release-dmgs: the two DMGs only", () => {
    const up = usesOf("desktop", "actions/upload-artifact@");
    assert.equal(up.length, 1);
    assert.equal(up[0].with.name, "release-dmgs");
    assert.deepEqual(String(up[0].with.path).trim().split("\n"), [
      `apps/desktop/release/Open-Agent-\${{ needs.gate.outputs.version }}-arm64.dmg`,
      `apps/desktop/release/Open-Agent-\${{ needs.gate.outputs.version }}-x64.dmg`,
    ]);
    assert.equal(up[0].with["if-no-files-found"], "error");
    assert.equal(Number(up[0].with["retention-days"]), 7);
  });
});

describe("verify-dmgs: no repo code, pinned shell checks (AC 28)", () => {
  it("needs lock and desktop, has no checkout, setup-node, npm or node", () => {
    assert.deepEqual(needsOf("verify-dmgs"), ["gate", "lock", "desktop"]);
    assert.equal(usesOf("verify-dmgs", "actions/checkout@").length, 0);
    assert.equal(usesOf("verify-dmgs", "actions/setup-node@").length, 0);
    for (const s of runsOf("verify-dmgs")) assert.doesNotMatch(s.run, /(^|\s)(npm|npx|node)\s/);
  });

  it("downloads release-lock and release-dmgs only, and runs exactly the pinned commands", () => {
    const d = usesOf("verify-dmgs", "actions/download-artifact@").map((s) => [s.with.name, s.with.path]);
    assert.deepEqual(d, [
      ["release-lock", `\${{ runner.temp }}/release-lock`],
      ["release-dmgs", `\${{ runner.temp }}/release-dmgs`],
    ]);
    const r = runsOf("verify-dmgs");
    assert.equal(r.length, 1);
    assert.equal(r[0].run, VERIFY_DMGS_RUN);
    assert.deepEqual(r[0].env, {
      VERSION: `\${{ needs.gate.outputs.version }}`,
      LOCK: `\${{ runner.temp }}/release-lock/services.lock.json`,
      DMGS: `\${{ runner.temp }}/release-dmgs`,
    });
  });

  it("the pinned commands mount read-only, require one Open Agent.app, a regular non-symlink lock, the same sha256 and the version", () => {
    for (const piece of [
      'hdiutil attach -nobrowse -readonly -mountpoint "$mnt" "$dmg"',
      'test "$apps" = 1',
      'app="$mnt/Open Agent.app"',
      'test -f "$lock"',
      'test ! -L "$lock"',
      'test "$got" = "$want"',
      'plutil -extract CFBundleShortVersionString raw "$app/Contents/Info.plist"',
      'test "$short" = "$VERSION"',
      'hdiutil detach "$mnt"',
    ])
      assert.ok(VERIFY_DMGS_RUN.includes(piece), piece);
    assert.equal(VERIFY_DMGS_RUN.includes("! test"), false, "! test never fails under set -e");
  });
});

describe("attest: SHA256SUMS from the lock job's manifest and the DMGs (AC 12, 28)", () => {
  it("needs verify-dmgs, no checkout, downloads release-lock and release-dmgs only into one folder", () => {
    assert.deepEqual(needsOf("attest"), ["gate", "verify-dmgs"]);
    const d = usesOf("attest", "actions/download-artifact@").map((s) => [s.with.name, s.with.path]);
    assert.deepEqual(d, [
      ["release-lock", `\${{ runner.temp }}/assets`],
      ["release-dmgs", `\${{ runner.temp }}/assets`],
    ]);
  });

  it("writes SHA256SUMS with sha256sum in sorted order and attests every listed file", () => {
    const r = runsOf("attest");
    assert.equal(r.length, 1);
    assert.equal(r[0].run, SUMS_RUN);
    assert.equal(r[0]["working-directory"], `\${{ runner.temp }}/assets`);
    const names = ["Open-Agent-$VERSION-arm64.dmg", "Open-Agent-$VERSION-x64.dmg", "open-agent-services.json"];
    assert.deepEqual([...names].sort(), names);
    const attest = usesOf("attest", "actions/attest-build-provenance@");
    assert.equal(attest.length, 1);
    assert.deepEqual(attest[0].with, { "subject-checksums": `\${{ runner.temp }}/assets/SHA256SUMS` });
    const up = usesOf("attest", "actions/upload-artifact@");
    assert.equal(up.length, 1);
    assert.equal(up[0].with.name, "release-sums");
    assert.equal(up[0].with.path, `\${{ runner.temp }}/assets/SHA256SUMS`);
  });
});

describe("release: a draft with exactly four assets (AC 13, 28)", () => {
  const creates = () => runsOf("release").filter((s) => s.run.startsWith("gh release create"));
  const ASSETS =
    '"$RUNNER_TEMP/release-dmgs/Open-Agent-$VERSION-arm64.dmg" "$RUNNER_TEMP/release-dmgs/Open-Agent-$VERSION-x64.dmg" "$RUNNER_TEMP/release-lock/open-agent-services.json" "$RUNNER_TEMP/release-sums/SHA256SUMS"';
  const CREATE = (pre) =>
    `gh release create "$TAG" --repo "$GITHUB_REPOSITORY" --draft --verify-tag --title "Open Agent $VERSION" --notes-file "$RUNNER_TEMP/release-lock/notes.md"${pre ? " --prerelease" : ""} ${ASSETS}`;

  it("needs attest, no checkout, downloads the three artifacts into their own folders", () => {
    assert.deepEqual(needsOf("release"), ["gate", "attest"]);
    const d = usesOf("release", "actions/download-artifact@").map((s) => [s.with.name, s.with.path]);
    assert.deepEqual(d, [
      ["release-lock", `\${{ runner.temp }}/release-lock`],
      ["release-dmgs", `\${{ runner.temp }}/release-dmgs`],
      ["release-sums", `\${{ runner.temp }}/release-sums`],
    ]);
    assert.deepEqual(job("release").env, {
      TAG: `\${{ needs.gate.outputs.tag }}`,
      VERSION: `\${{ needs.gate.outputs.version }}`,
      GH_TOKEN: `\${{ github.token }}`,
      ASSET_ARM64: `Open-Agent-\${{ needs.gate.outputs.version }}-arm64.dmg`,
      ASSET_X64: `Open-Agent-\${{ needs.gate.outputs.version }}-x64.dmg`,
      ASSET_MANIFEST: "open-agent-services.json",
      ASSET_SUMS: "SHA256SUMS",
    });
  });

  it("refuses an existing release (drafts included) through the releases API before creating", () => {
    const existing = at("release", (s) => s.run === RELEASE_EXISTING_RUN);
    const first = at("release", (s) => (s.run ?? "").startsWith("gh release create"));
    assert.ok(existing >= 0 && first > existing);
  });

  it("creates a draft with --verify-tag, the manifest and notes from release-lock and the sums from release-sums, prerelease only for -rc", () => {
    const c = creates();
    assert.equal(c.length, 2);
    const pre = c.find((s) => s.if === "needs.gate.outputs.prerelease == 'true'");
    const final = c.find((s) => s.if === "needs.gate.outputs.prerelease != 'true'");
    assert.equal(pre?.run.trim(), CREATE(true));
    assert.equal(final?.run.trim(), CREATE(false));
  });

  it("checks the draft and its four asset names afterwards, and never publishes, edits or deletes", () => {
    const view = at("release", (s) => s.run === RELEASE_VIEW_RUN);
    const last = Math.max(...creates().map((s) => steps("release").indexOf(s)));
    assert.ok(view > last);
    const text = read(RELEASE);
    for (const bad of ["gh release edit", "gh release delete", "gh release upload", "--draft=false", "--latest", "gh api -X", "--method"])
      assert.equal(text.includes(bad), false, bad);
  });
});

describe("CODEOWNERS (D16 3b)", () => {
  it("names the owner for workflows, release, docs and demo scripts, the release policy, INSTALL and README", () => {
    const lines = read(".github/CODEOWNERS")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    for (const path of [
      "/.github/workflows/",
      "/scripts/release/",
      "/scripts/docs/",
      "/scripts/demo/",
      "/apps/desktop/release-policy.json",
      "/docs/INSTALL.md",
      "/README.md",
      "/.github/CODEOWNERS",
    ])
      assert.ok(lines.includes(`${path} @Nit-1997`), path);
  });
});

describe("actionlint (D12)", () => {
  it("lint:workflows runs a digest-pinned actionlint image read-only and removes the container", () => {
    const script = JSON.parse(read("package.json")).scripts["lint:workflows"];
    assert.match(script, /^docker run --rm -v "\$PWD:\/repo:ro" -w \/repo rhysd\/actionlint:\d+\.\d+\.\d+@sha256:[0-9a-f]{64} -color$/);
  });

  it("ci.yml's compose job runs it", () => {
    const ci = parse(read(".github/workflows/ci.yml"));
    assert.ok(ci.jobs.compose.steps.some((s) => s.run?.trim() === "npm run lint:workflows"));
  });
});

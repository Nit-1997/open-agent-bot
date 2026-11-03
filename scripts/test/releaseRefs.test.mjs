import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const FIX = join(ROOT, "scripts/test/fixtures/release");
const D = (c) => `sha256:${c.repeat(64)}`;
const SHA = "0123456789abcdef0123456789abcdef01234567";
const TAG = "v1.0.0-rc.1";
const AGENT = "ghcr.io/nit-1997/open-agent";
const SEARCH = "ghcr.io/nit-1997/open-agent-search";
const SIGNER = `https://github.com/Nit-1997/open-agent-bot/.github/workflows/release.yml@refs/tags/${TAG}`;

const scratch = () => mkdtempSync(join(tmpdir(), "oab-m5-refs-"));
const script = (n) => join(ROOT, "scripts/release", n);
const run = (name, args, env = {}) => {
  const dir = scratch();
  const out = join(dir, "github-output");
  const r = spawnSync(process.execPath, [script(name), ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, GITHUB_OUTPUT: out, ...env },
  });
  const outputs = existsSync(out) ? readFileSync(out, "utf8") : "";
  rmSync(dir, { recursive: true, force: true });
  return { ...r, outputs };
};
const outputsOf = (text) =>
  Object.fromEntries(
    text
      .split("\n")
      .filter(Boolean)
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );

describe("refs.mjs record (push job)", () => {
  it("writes the per-arch digest to <dir>/<arch>", () => {
    const dir = scratch();
    const r = run("refs.mjs", ["record", "--arch", "arm64", "--digest", D("a"), "--dir", join(dir, "digests")]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(join(dir, "digests/arm64"), "utf8"), `${D("a")}\n`);
    rmSync(dir, { recursive: true });
  });

  it("refuses an unknown arch or a malformed digest", () => {
    const dir = scratch();
    assert.equal(run("refs.mjs", ["record", "--arch", "arm", "--digest", D("a"), "--dir", dir]).status, 1);
    assert.equal(run("refs.mjs", ["record", "--arch", "amd64", "--digest", "sha256:abc", "--dir", dir]).status, 1);
    assert.equal(run("refs.mjs", ["record", "--arch", "amd64", "--dir", dir]).status, 1);
    rmSync(dir, { recursive: true });
  });
});

describe("refs.mjs merge-inputs (merge job)", () => {
  const digests = (files) => {
    const dir = scratch();
    for (const [n, v] of Object.entries(files)) writeFileSync(join(dir, n), v);
    return dir;
  };
  const merge = (files, extra = {}) => {
    const dir = digests(files);
    const o = { name: AGENT, version: "1.0.0-rc.1", sha: SHA, ...extra };
    const r = run("refs.mjs", ["merge-inputs", "--dir", dir, "--name", o.name, "--version", o.version, "--sha", o.sha]);
    rmSync(dir, { recursive: true });
    return r;
  };
  const both = { amd64: `${D("a")}\n`, arm64: `${D("b")}\n` };

  it("prints both per-arch refs and the two tags :<version> and :sha-<7>", () => {
    const r = merge(both);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(outputsOf(r.outputs), {
      amd64: `${AGENT}@${D("a")}`,
      arm64: `${AGENT}@${D("b")}`,
      version_tag: `${AGENT}:1.0.0-rc.1`,
      sha_tag: `${AGENT}:sha-0123456`,
    });
  });

  it("refuses a missing arch, an extra file, a bad digest, a non-production name, a v-prefixed version and a short sha", () => {
    assert.match(merge({ amd64: both.amd64 }).stderr, /arm64/);
    assert.match(merge({ ...both, extra: "x" }).stderr, /extra/);
    assert.match(merge({ ...both, arm64: "sha256:zz\n" }).stderr, /digest/);
    assert.match(merge(both, { name: "ghcr.io/someone/open-agent" }).stderr, /name/);
    assert.match(merge(both, { version: "v1.0.0" }).stderr, /version/);
    assert.match(merge(both, { version: "latest" }).stderr, /version/);
    assert.match(merge(both, { sha: "0123456" }).stderr, /sha/);
    for (const r of [merge({ amd64: both.amd64 }), merge(both, { version: "v1.0.0" })]) {
      assert.equal(r.status, 1);
      assert.equal(r.outputs, "");
    }
  });
});

describe("image-checks.mjs merge-digest --out / --inspect", () => {
  it("--out writes {name, digest} for the index artifact", () => {
    const dir = scratch();
    const out = join(dir, "index/open-agent.json");
    const r = run("image-checks.mjs", [
      "merge-digest",
      "--metadata",
      join(FIX, "imagetools-create-metadata.json"),
      "--name",
      AGENT,
      "--out",
      out,
    ]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), {
      name: AGENT,
      digest: "sha256:329912742a9b65eeb63f23b143a78aa87ea7cdc3fac0fd78526c6e1b8becd0d0",
    });
    rmSync(dir, { recursive: true });
  });

  it("--out needs --name", () => {
    const dir = scratch();
    const r = run("image-checks.mjs", [
      "merge-digest",
      "--metadata",
      join(FIX, "imagetools-create-metadata.json"),
      "--out",
      join(dir, "x.json"),
    ]);
    assert.equal(r.status, 1);
    assert.equal(existsSync(join(dir, "x.json")), false);
    rmSync(dir, { recursive: true });
  });

  it("--inspect reads the imagetools inspect JSON from a file", () => {
    const r = run("image-checks.mjs", ["merge-digest", "--inspect", join(FIX, "imagetools-inspect-manifest.json")]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(outputsOf(r.outputs).digest, "sha256:e9f3144a07bcd5b417dfcc06deda0947442526406d4dd208ffaa4026ee372143");
  });
});

describe("refs.mjs lock-inputs (lock job)", () => {
  const indexDir = (entries) => {
    const dir = scratch();
    for (const [file, v] of Object.entries(entries)) writeFileSync(join(dir, file), typeof v === "string" ? v : JSON.stringify(v));
    return dir;
  };
  const good = { "open-agent.json": { name: AGENT, digest: D("c") }, "open-agent-search.json": { name: SEARCH, digest: D("d") } };
  const lock = (entries, version = "1.0.0") => {
    const dir = indexDir(entries);
    const out = join(dir, "out/release-lock");
    const r = run("refs.mjs", ["lock-inputs", "--dir", dir, "--version", version, "--out-dir", out]);
    const made = existsSync(out);
    rmSync(dir, { recursive: true });
    return { ...r, made };
  };

  it("prints the index refs and version tags of both images and creates the out dir", () => {
    const r = lock(good);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.made);
    assert.deepEqual(outputsOf(r.outputs), {
      agent: `${AGENT}@${D("c")}`,
      search: `${SEARCH}@${D("d")}`,
      agent_tag: `${AGENT}:1.0.0`,
      search_tag: `${SEARCH}:1.0.0`,
    });
  });

  it("refuses a missing or extra file, a swapped or foreign name, a bad digest and a bad version", () => {
    const cases = [
      { "open-agent.json": good["open-agent.json"] },
      { ...good, "other.json": good["open-agent.json"] },
      { "open-agent.json": good["open-agent-search.json"], "open-agent-search.json": good["open-agent.json"] },
      { ...good, "open-agent.json": { name: "ghcr.io/evil/open-agent", digest: D("c") } },
      { ...good, "open-agent.json": { name: AGENT, digest: "sha256:1" } },
      { ...good, "open-agent.json": "not json" },
    ];
    for (const c of cases) {
      const r = lock(c);
      assert.equal(r.status, 1, JSON.stringify(c));
      assert.equal(r.outputs, "");
    }
    assert.equal(lock(good, "v1.0.0").status, 1);
  });
});

describe("attested.mjs (lock job, after gh attestation verify)", () => {
  const result = (digest, o = {}) => ({
    verificationResult: {
      statement: {
        subject: [{ name: o.name ?? AGENT, digest: { sha256: digest.slice(7) } }],
        predicateType: "https://slsa.dev/provenance/v1",
      },
      signature: {
        certificate: {
          buildSignerURI: o.signer ?? SIGNER,
          sourceRepositoryURI: o.repo ?? "https://github.com/Nit-1997/open-agent-bot",
          sourceRepositoryRef: o.ref ?? `refs/tags/${TAG}`,
          sourceRepositoryDigest: o.sha ?? SHA,
          runnerEnvironment: o.runner ?? "github-hosted",
        },
      },
    },
  });
  const attest = (agentResults, searchResults, extra = []) => {
    const dir = scratch();
    const a = join(dir, "attestation-agent.json");
    const s = join(dir, "attestation-search.json");
    writeFileSync(a, typeof agentResults === "string" ? agentResults : JSON.stringify(agentResults));
    writeFileSync(s, typeof searchResults === "string" ? searchResults : JSON.stringify(searchResults));
    const out = join(dir, "lock/attested.json");
    mkdirSync(dirname(out));
    const args = ["--tag", TAG, "--sha", SHA, "--agent", `${AGENT}@${D("c")}`, "--search", `${SEARCH}@${D("d")}`];
    const r = run("attested.mjs", [...args, "--agent-result", a, "--search-result", s, "--out", out, ...extra]);
    const written = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : undefined;
    return { ...r, written, dir, out };
  };

  it("writes attested.json from two passing verification results, and write-lock accepts it", () => {
    const r = attest([result(D("c"))], [result(D("d"), { name: SEARCH })]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.written, {
      agent: { ref: `${AGENT}@${D("c")}`, digest: D("c"), verified: true },
      search: { ref: `${SEARCH}@${D("d")}`, digest: D("d"), verified: true },
    });
    const w = spawnSync(
      process.execPath,
      [
        script("write-lock.mjs"),
        ...["--version", "1.0.0-rc.1", "--agent", `${AGENT}@${D("c")}`, "--search", `${SEARCH}@${D("d")}`],
        ...["--out-lock", join(r.dir, "lock/services.lock.json"), "--out-manifest", join(r.dir, "lock/open-agent-services.json")],
        ...["--attested", r.out],
      ],
      { encoding: "utf8", env: { PATH: process.env.PATH } },
    );
    assert.equal(w.status, 0, w.stderr);
    rmSync(r.dir, { recursive: true });
  });

  const refused = {
    "no verification results": [[], [result(D("d"), { name: SEARCH })]],
    "a subject digest that is not the ref's": [[result(D("e"))], [result(D("d"), { name: SEARCH })]],
    "another signer workflow": [[result(D("c"), { signer: SIGNER.replace("release.yml", "ci.yml") })], [result(D("d"), { name: SEARCH })]],
    "another tag": [[result(D("c"), { ref: "refs/tags/v9.9.9" })], [result(D("d"), { name: SEARCH })]],
    "another commit": [[result(D("c"), { sha: "f".repeat(40) })], [result(D("d"), { name: SEARCH })]],
    "a self-hosted runner": [[result(D("c"))], [result(D("d"), { name: SEARCH, runner: "self-hosted" })]],
    "another repository": [[result(D("c"), { repo: "https://github.com/evil/open-agent-bot" })], [result(D("d"), { name: SEARCH })]],
    "one good and one bad result for the same image": [
      [result(D("c")), result(D("c"), { sha: "f".repeat(40) })],
      [result(D("d"), { name: SEARCH })],
    ],
    "output that is not JSON": ["Loaded digest sha256:…", [result(D("d"), { name: SEARCH })]],
  };
  for (const [why, [a, s]] of Object.entries(refused))
    it(`refuses ${why} and writes nothing`, () => {
      const r = attest(a, s);
      assert.equal(r.status, 1, why);
      assert.equal(r.written, undefined);
      assert.match(r.stderr, /attested:/);
      rmSync(r.dir, { recursive: true });
    });

  it("refuses non-production refs and a malformed tag or sha", () => {
    const good = [[result(D("c"))], [result(D("d"), { name: SEARCH })]];
    for (const extra of [
      ["--agent", `127.0.0.1:18501/oab-m5-open-agent@${D("c")}`],
      ["--tag", "1.0.0"],
      ["--sha", "abc"],
    ]) {
      const r = attest(...good, extra);
      assert.equal(r.status, 1, extra.join(" "));
      assert.equal(r.written, undefined);
      rmSync(r.dir, { recursive: true });
    }
  });
});

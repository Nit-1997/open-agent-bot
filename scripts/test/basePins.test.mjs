import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const json = (f) => JSON.parse(read(f));

const inScope = (f) =>
  /(^|\/)Dockerfile[^/]*$/.test(f) ||
  f.startsWith(".github/workflows/") ||
  f === "CONTRIBUTING.md" ||
  f === "README.md" ||
  (f.startsWith("docs/") && f.endsWith(".md") && !f.startsWith("docs/superpowers/")) ||
  (f.startsWith("scripts/") && !f.startsWith("scripts/test/"));

const PLAYWRIGHT_REF = /mcr\.microsoft\.com\/playwright:(\S*?)(?=["'\s]|$)/gm;
const PINNED = /^v(\d+\.\d+\.\d+)-noble@sha256:[0-9a-f]{64}$/;
const WORKFLOWS = tracked.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f));

describe("base image pins (D11)", () => {
  const refs = tracked.filter(inScope).flatMap((f) => [...read(f).matchAll(PLAYWRIGHT_REF)].map((m) => ({ file: f, tag: m[1] })));

  it("finds the Playwright base in the agent Dockerfile, ci.yml and CONTRIBUTING.md", () => {
    for (const f of ["packages/core/Dockerfile", ".github/workflows/ci.yml", "CONTRIBUTING.md"])
      assert.ok(
        refs.some((r) => r.file === f),
        f,
      );
  });

  it("every Playwright reference is the same v<x>-noble@sha256:<64>", () => {
    for (const r of refs) assert.match(r.tag, PINNED, `${r.file}: mcr.microsoft.com/playwright:${r.tag}`);
    assert.equal(new Set(refs.map((r) => r.tag)).size, 1, [...new Set(refs.map((r) => `${r.file} ${r.tag}`))].join("\n"));
  });

  it("the Playwright version equals the npm pins in packages/core and e2e", () => {
    const version = PINNED.exec(refs[0].tag)?.[1];
    assert.equal(
      json("packages/core/package.json").dependencies?.playwright ?? json("packages/core/package.json").devDependencies?.playwright,
      version,
    );
    assert.equal(
      json("e2e/package.json").devDependencies?.["@playwright/test"] ?? json("e2e/package.json").dependencies?.["@playwright/test"],
      version,
    );
  });

  it("the SearXNG base is pinned by digest", () => {
    const from = [...read("local/searxng/Dockerfile").matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1]);
    assert.ok(from.length > 0);
    for (const f of from) assert.match(f, /^searxng\/searxng:[\w.-]+@sha256:[0-9a-f]{64}$/);
  });

  it("no workflow uses a :latest image without a digest", () => {
    for (const f of WORKFLOWS)
      for (const m of read(f).matchAll(/[\w./-]+:latest(@sha256:[0-9a-f]{64})?/g)) assert.ok(m[1], `${f}: ${m[0]} has no digest`);
  });

  const release = ".github/workflows/release.yml";
  it("release.yml pins the buildx version and a digest-pinned BuildKit image", {
    skip: !existsSync(join(ROOT, release)) && "release.yml lands in PR 5.2",
  }, () => {
    const wf = parse(read(release));
    const steps = Object.values(wf.jobs ?? {}).flatMap((j) => j.steps ?? []);
    const buildx = steps.filter((s) => String(s.uses ?? "").startsWith("docker/setup-buildx-action@"));
    assert.ok(buildx.length > 0);
    for (const s of buildx) {
      assert.match(String(s.with?.version ?? ""), /^v\d+\.\d+\.\d+$/);
      assert.match(String(s.with?.["driver-opts"] ?? ""), /image=moby\/buildkit:v[\d.]+@sha256:[0-9a-f]{64}/);
    }
  });
});

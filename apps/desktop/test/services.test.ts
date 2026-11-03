import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareSemver, effectivePins, type ServicePins, stackRefs, validatePins } from "../src/main/services.ts";

const SHA = "1".repeat(64);
const D = (c: string) => c.repeat(64);
const prod = { test: false, composeSha256: SHA, shellVersion: "1.4.0" };
const test_ = { ...prod, test: true };
const release = (o: Record<string, unknown> = {}) => ({
  schema: 1,
  kind: "release",
  version: "1.4.0",
  composeSha256: SHA,
  images: { agent: `ghcr.io/nit-1997/open-agent@sha256:${D("a")}`, search: `ghcr.io/nit-1997/open-agent-search@sha256:${D("b")}` },
  ...o,
});
const local = (o: Record<string, unknown> = {}) => ({
  schema: 1,
  kind: "local",
  version: "local-abc1234",
  composeSha256: SHA,
  images: { agent: "open-agent:local", search: "open-agent-search:local" },
  imageIds: { agent: `sha256:${D("c")}`, search: `sha256:${D("d")}` },
  pull: false,
  ...o,
});

describe("validatePins (D12, D22)", () => {
  it.each<[string, unknown, typeof prod, string | true]>([
    ["a release lock", release(), prod, true],
    [
      "a tag is refused",
      release({ images: { agent: "ghcr.io/nit-1997/open-agent:1.4.0", search: `ghcr.io/nit-1997/open-agent-search@sha256:${D("b")}` } }),
      prod,
      "release_refs",
    ],
    [
      "a wrong repo",
      release({
        images: { agent: `ghcr.io/evil/open-agent@sha256:${D("a")}`, search: `ghcr.io/nit-1997/open-agent-search@sha256:${D("b")}` },
      }),
      prod,
      "release_refs",
    ],
    [
      "uppercase hex",
      release({
        images: { agent: `ghcr.io/nit-1997/open-agent@sha256:${D("A")}`, search: `ghcr.io/nit-1997/open-agent-search@sha256:${D("b")}` },
      }),
      prod,
      "release_refs",
    ],
    [
      "a short digest",
      release({
        images: {
          agent: `ghcr.io/nit-1997/open-agent@sha256:${"a".repeat(63)}`,
          search: `ghcr.io/nit-1997/open-agent-search@sha256:${D("b")}`,
        },
      }),
      prod,
      "release_refs",
    ],
    ["the compose hash", release({ composeSha256: "2".repeat(64) }), prod, "compose_mismatch"],
    ["minShellVersion newer than the app", release({ minShellVersion: "1.5.0" }), prod, "shell_too_old"],
    ["minShellVersion equal", release({ minShellVersion: "1.4.0" }), prod, true],
    ["images: null", release({ images: null }), prod, "no_pins"],
    ["the committed template", { schema: 1, kind: "release", version: "dev", composeSha256: SHA, images: null }, prod, "no_pins"],
    ["a lock without kind", { schema: 1, version: "dev", composeSha256: SHA, images: null }, prod, "kind"],
    ["a release without kind", { ...release(), kind: undefined }, prod, "kind"],
    ["a dev file without kind in test mode", { ...release(), kind: undefined }, test_, "kind"],
    ["schema 2", release({ schema: 2 }), prod, "schema"],
    [
      "an extra image",
      release({
        images: {
          agent: `ghcr.io/nit-1997/open-agent@sha256:${D("a")}`,
          search: `ghcr.io/nit-1997/open-agent-search@sha256:${D("b")}`,
          x: "y",
        },
      }),
      prod,
      "images",
    ],
    ["a local lock", local(), prod, true],
    ["a local lock with wrong refs", local({ images: { agent: "evil:local", search: "open-agent-search:local" } }), prod, "local_refs"],
    ["a local lock missing imageIds", local({ imageIds: undefined }), prod, "local_image_ids"],
    ["a local lock with a bad imageId", local({ imageIds: { agent: "sha256:xyz", search: `sha256:${D("d")}` } }), prod, "local_image_ids"],
    ["a local lock with pull", local({ pull: true }), prod, "local_pull"],
    [
      "dev refs outside test mode",
      {
        schema: 1,
        kind: "dev",
        version: "0.0.0-x",
        composeSha256: SHA,
        images: { agent: "oab-m4-agent:dev", search: "oab-m4-search:dev" },
        pull: false,
      },
      prod,
      "dev_outside_test",
    ],
    [
      "dev local tags in test mode",
      {
        schema: 1,
        kind: "dev",
        version: "0.0.0-x",
        composeSha256: SHA,
        images: { agent: "oab-m4-agent:dev", search: "oab-m4-search:dev" },
        pull: false,
      },
      test_,
      true,
    ],
    [
      "dev local tags cannot be pulled",
      {
        schema: 1,
        kind: "dev",
        version: "0.0.0-x",
        composeSha256: SHA,
        images: { agent: "oab-m4-agent:dev", search: "oab-m4-search:dev" },
        pull: true,
      },
      test_,
      "tag_pull",
    ],
    [
      "a test registry digest",
      {
        schema: 1,
        kind: "dev",
        version: "0.0.0-m4a",
        composeSha256: SHA,
        images: { agent: `127.0.0.1:18467/oab-m4-agent@sha256:${D("a")}`, search: `127.0.0.1:18467/oab-m4-search@sha256:${D("b")}` },
      },
      test_,
      true,
    ],
    [
      "a registry outside 18xxx",
      {
        schema: 1,
        kind: "dev",
        version: "0.0.0-m4a",
        composeSha256: SHA,
        images: { agent: `127.0.0.1:5000/oab-m4-agent@sha256:${D("a")}`, search: `127.0.0.1:18467/oab-m4-search@sha256:${D("b")}` },
      },
      test_,
      "test_refs",
    ],
    [
      "a non-oab test tag",
      {
        schema: 1,
        kind: "dev",
        version: "0.0.0-x",
        composeSha256: SHA,
        images: { agent: "evil:dev", search: "oab-m4-search:dev" },
        pull: false,
      },
      test_,
      "test_refs",
    ],
  ])("%s", (_name, v, ctx, want) => {
    const r = validatePins(v, ctx);
    if (want === true) expect(r.ok, JSON.stringify(r)).toBe(true);
    else expect(r).toEqual({ ok: false, reason: want });
  });

  it("a release lock keeps pull on and the images", () => {
    const r = validatePins(release(), prod);
    expect(r).toEqual({ ok: true, pins: { kind: "release", version: "1.4.0", composeSha256: SHA, images: release().images, pull: true } });
  });
});

describe("effectivePins", () => {
  const pins = (version: string, kind: ServicePins["kind"] = "release"): ServicePins => ({
    kind,
    version,
    composeSha256: SHA,
    images: { agent: "a", search: "s" },
    pull: true,
  });
  it("the newer of the accepted manifest and the bundled lock; a local lock is never replaced", () => {
    expect(effectivePins(pins("1.4.0"), pins("1.4.1"))?.version).toBe("1.4.1");
    expect(effectivePins(pins("1.5.0"), pins("1.4.1"))?.version).toBe("1.5.0");
    expect(effectivePins(pins("local-x", "local"), pins("9.9.9"))?.version).toBe("local-x");
    expect(effectivePins(undefined, undefined)).toBeUndefined();
  });
  it("compares semver", () => {
    expect(compareSemver("1.4.0", "1.4.0")).toBe(0);
    expect(compareSemver("1.10.0", "1.9.9")).toBe(1);
    expect(compareSemver("1.4.0-rc.1", "1.4.0")).toBe(-1);
    expect(compareSemver("0.0.0-m4a", "0.0.0-m4b")).toBe(-1);
  });
  it("compares prerelease identifiers by semver precedence", () => {
    expect(compareSemver("1.4.0-rc.10", "1.4.0-rc.9")).toBe(1);
    expect(compareSemver("1.4.0-rc.9", "1.4.0-rc.10")).toBe(-1);
    expect(compareSemver("1.4.0-rc.2", "1.4.0-rc.2")).toBe(0);
    expect(compareSemver("1.4.0-alpha", "1.4.0-alpha.1")).toBe(-1);
    expect(compareSemver("1.4.0-alpha.1", "1.4.0-alpha.beta")).toBe(-1);
    expect(compareSemver("1.4.0-alpha.beta", "1.4.0-beta")).toBe(-1);
    expect(compareSemver("1.4.0-beta.11", "1.4.0-beta.2")).toBe(1);
    expect(compareSemver("1.4.0-1", "1.4.0-alpha")).toBe(-1);
    expect(compareSemver("1.4.0-rc.1", "1.4.0")).toBe(-1);
    expect(compareSemver("1.4.0+b2", "1.4.0+b1")).toBe(0);
  });
});

describe("the committed services.lock.json", () => {
  it("names its kind and has no pins until a release fills them", () => {
    const lock = JSON.parse(readFileSync(join(__dirname, "../services.lock.json"), "utf8")) as Record<string, unknown>;
    expect(lock.kind).toBe("release");
    expect(validatePins(lock, { test: false, composeSha256: String(lock.composeSha256), shellVersion: "1.4.0" })).toEqual({
      ok: false,
      reason: "no_pins",
    });
  });
});

describe("stackRefs (S4)", () => {
  const ids = { agent: `sha256:${D("e")}`, search: `sha256:${D("f")}` };
  it("a local lock runs by image Id; other pins run by their refs", () => {
    const base = { version: "v", composeSha256: SHA, images: { agent: "open-agent:local", search: "open-agent-search:local" } };
    expect(stackRefs({ ...base, kind: "local", imageIds: ids, pull: false })).toEqual(ids);
    expect(stackRefs({ ...base, kind: "dev", pull: false })).toEqual(base.images);
  });
});

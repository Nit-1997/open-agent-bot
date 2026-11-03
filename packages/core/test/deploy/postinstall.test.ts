import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "../../../scripts/postinstall.mjs");

type Layout = "absent" | "hoisted" | "nested";

async function fakeRoot(layout: Layout) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "postinstall-")));
  await mkdir(join(root, "scripts"));
  await copyFile(SCRIPT, join(root, "scripts/postinstall.mjs"));
  await mkdir(join(root, "agent"));
  await writeFile(join(root, "agent/package.json"), '{"name":"agent"}');
  if (layout !== "absent") {
    const base = layout === "hoisted" ? root : join(root, "agent");
    const pkg = join(base, "node_modules/@earendil-works/pi-ai");
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, "package.json"), '{"name":"@earendil-works/pi-ai","version":"1.4.0"}');
  }
  const bin = join(root, "bin");
  await mkdir(bin);
  const log = join(root, "patch-package.log");
  await writeFile(join(bin, "patch-package"), `#!/bin/sh\necho "$PWD $*" > "${log}"\nexit "\${FAKE_EXIT:-0}"\n`);
  await chmod(join(bin, "patch-package"), 0o755);
  return { root, bin, log };
}

async function runPostinstall(layout: Layout, fakeExit = "0") {
  const { root, bin, log } = await fakeRoot(layout);
  const res = spawnSync(process.execPath, [join(root, "scripts/postinstall.mjs")], {
    cwd: tmpdir(),
    env: { PATH: `${bin}:${process.env.PATH}`, FAKE_EXIT: fakeExit },
    encoding: "utf8",
  });
  const called = await readFile(log, "utf8").catch(() => null);
  return { root, status: res.status, out: `${res.stdout}${res.stderr}`, called };
}

describe("root postinstall", () => {
  it("skips patches with a message when pi-ai is not installed", async () => {
    const r = await runPostinstall("absent");
    expect(r.status).toBe(0);
    expect(r.out).toContain("pi-ai not installed, patches skipped");
    expect(r.called).toBeNull();
  });

  it.each<Layout>(["hoisted", "nested"])("runs patch-package --error-on-fail from the root when pi-ai is %s", async (layout) => {
    const r = await runPostinstall(layout);
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("patches skipped");
    expect(r.called?.trim()).toBe(`${r.root} --error-on-fail`);
  });

  it("fails the install when patch-package fails", async () => {
    const r = await runPostinstall("hoisted", "3");
    expect(r.status).toBe(3);
    expect(r.called).not.toBeNull();
  });

  it("fails the install when patch-package is missing", async () => {
    const { root } = await fakeRoot("hoisted");
    const res = spawnSync(process.execPath, [join(root, "scripts/postinstall.mjs")], { env: { PATH: "/nonexistent" }, encoding: "utf8" });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("patch-package failed to start");
  });
});

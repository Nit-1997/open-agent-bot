import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  cliPluginDirs,
  cliPluginsProblem,
  composeAtLeast,
  type DockerCli,
  dockerCandidates,
  dockerEnv,
  dockerPath,
  ENV_ALLOWLIST,
  engineOf,
  locateDocker,
  pluginPathsProblem,
  probeDocker,
  type RunResult,
  trustedPath,
} from "../src/main/dockerCli.ts";
import type { FsProbe, FsStat } from "../src/main/fsProbe.ts";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures/docker");
const UID = 501;
const HOME = "/Users/tester";

type Node = { kind: FsStat["kind"]; uid?: number; gid?: number; mode?: number; target?: string; exec?: boolean; text?: string };

function fakeFs(nodes: Record<string, Node>): FsProbe {
  const resolveLink = (p: string, depth = 0): string | undefined => {
    if (depth > 8) return undefined;
    const parts = p.split("/").filter(Boolean);
    let cur = "";
    for (let i = 0; i < parts.length; i++) {
      cur = `${cur}/${parts[i]}`;
      const n = nodes[cur];
      if (!n) return undefined;
      if (n.kind === "symlink" && n.target) {
        const rest = parts.slice(i + 1).join("/");
        return resolveLink(rest ? `${n.target}/${rest}` : n.target, depth + 1);
      }
    }
    return cur || "/";
  };
  const statOf = (n: Node): FsStat => ({ kind: n.kind, uid: n.uid ?? 0, gid: n.gid ?? 0, mode: n.mode ?? 0o755 });
  return {
    lstat: (p) => (p === "/" ? statOf({ kind: "dir" }) : nodes[p] ? statOf(nodes[p]!) : undefined),
    stat: (p) => {
      const r = resolveLink(p);
      if (r === "/") return statOf({ kind: "dir" });
      return r && nodes[r] ? statOf(nodes[r]!) : undefined;
    },
    realpath: (p) => (p === "/" ? "/" : resolveLink(p)),
    executable: (p) => {
      const r = resolveLink(p);
      return r !== undefined && nodes[r]?.exec !== false;
    },
    list: (p) => {
      if (nodes[p]?.kind !== "dir") return undefined;
      const prefix = `${p}/`;
      return Object.keys(nodes)
        .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/"))
        .map((k) => k.slice(prefix.length));
    },
    readText: (p) => {
      const r = resolveLink(p);
      return r ? nodes[r]?.text : undefined;
    },
  };
}

const dir = (o: Partial<Node> = {}): Node => ({ kind: "dir", mode: 0o755, ...o });
const exe = (o: Partial<Node> = {}): Node => ({ kind: "file", mode: 0o755, ...o });

const BASE: Record<string, Node> = {
  "/usr": dir(),
  "/usr/local": dir(),
  "/usr/local/bin": dir(),
  "/usr/bin": dir(),
  "/bin": dir(),
  "/usr/sbin": dir(),
  "/sbin": dir(),
  "/Applications": dir({ gid: 80, mode: 0o775 }),
  "/Applications/Docker.app": dir(),
  "/Applications/Docker.app/Contents": dir(),
  "/Applications/Docker.app/Contents/Resources": dir(),
  "/Applications/Docker.app/Contents/Resources/bin": dir(),
  "/Applications/Docker.app/Contents/Resources/bin/docker": exe(),
  "/Users": dir({ gid: 80 }),
  [HOME]: dir({ uid: UID, gid: 20 }),
};

describe("locateDocker (D11 order + S2)", () => {
  it("lists the fixed candidates in order, including Rancher Desktop", () => {
    expect(dockerCandidates(HOME)).toEqual([
      "/usr/local/bin/docker",
      "/opt/homebrew/bin/docker",
      `${HOME}/.docker/bin/docker`,
      `${HOME}/.orbstack/bin/docker`,
      "/Applications/Docker.app/Contents/Resources/bin/docker",
      "/Applications/OrbStack.app/Contents/MacOS/xbin/docker",
      `${HOME}/.rd/bin/docker`,
      "/usr/bin/docker",
    ]);
  });

  it("takes the first trusted match: the Docker Desktop symlink in /usr/local/bin (target under admin-group /Applications)", () => {
    const fs = fakeFs({
      ...BASE,
      "/usr/local/bin/docker": { kind: "symlink", target: "/Applications/Docker.app/Contents/Resources/bin/docker" },
    });
    const loc = locateDocker({ test: false }, { fs, uid: UID, home: HOME });
    expect(loc).toMatchObject({ kind: "found", path: "/usr/local/bin/docker", rejected: [] });
  });

  it("accepts Homebrew's user:admin 0775 prefix and refuses the same dir with group staff", () => {
    const brew = (gid: number) => ({
      ...BASE,
      "/opt": dir(),
      "/opt/homebrew": dir({ uid: UID, gid, mode: 0o775 }),
      "/opt/homebrew/bin": dir({ uid: UID, gid, mode: 0o775 }),
      "/opt/homebrew/bin/docker": exe({ uid: UID, gid }),
    });
    expect(locateDocker({ test: false }, { fs: fakeFs(brew(80)), uid: UID, home: HOME })).toMatchObject({
      kind: "found",
      path: "/opt/homebrew/bin/docker",
    });
    const staff = locateDocker({ test: false }, { fs: fakeFs(brew(20)), uid: UID, home: HOME });
    expect(staff.kind).toBe("found");
    expect(staff.rejected).toEqual([
      { path: "/opt/homebrew/bin/docker", reason: "/opt/homebrew/bin/docker: parent /opt/homebrew/bin is group-writable" },
    ]);
  });

  it("rejects a group-writable parent, an other-writable target and a foreign-owned symlink target, each with its reason", () => {
    const fs = fakeFs({
      ...BASE,
      "/usr/local/bin": dir({ gid: 20, mode: 0o775 }),
      "/usr/local/bin/docker": exe(),
      "/opt": dir(),
      "/opt/homebrew": dir({ uid: UID, gid: 80 }),
      "/opt/homebrew/bin": dir({ uid: UID, gid: 80 }),
      "/opt/homebrew/bin/docker": exe({ uid: UID, mode: 0o757 }),
      [`${HOME}/.docker`]: dir({ uid: UID }),
      [`${HOME}/.docker/bin`]: dir({ uid: UID }),
      [`${HOME}/.docker/bin/docker`]: { kind: "symlink", uid: UID, target: "/tmp/evil/docker" },
      "/tmp": dir({ mode: 0o1777 }),
      "/tmp/evil": dir({ uid: 502 }),
      "/tmp/evil/docker": exe({ uid: 502 }),
    });
    const loc = locateDocker({ test: false }, { fs, uid: UID, home: HOME });
    expect(loc.kind).toBe("found");
    expect(loc).toMatchObject({ path: "/Applications/Docker.app/Contents/Resources/bin/docker" });
    expect(loc.rejected).toEqual([
      { path: "/usr/local/bin/docker", reason: "/usr/local/bin/docker: parent /usr/local/bin is group-writable" },
      { path: "/opt/homebrew/bin/docker", reason: "/opt/homebrew/bin/docker: is other-writable" },
      { path: `${HOME}/.docker/bin/docker`, reason: `${HOME}/.docker/bin/docker: target /tmp/evil/docker is owned by uid 502` },
    ]);
  });

  it("in test mode the override is the only candidate; a missing override is dockerMissing, never a real CLI", () => {
    const fs = fakeFs({ ...BASE, "/usr/local/bin/docker": exe() });
    expect(locateDocker({ test: true, dockerOverride: "/nope/docker" }, { fs, uid: UID, home: HOME })).toEqual({
      kind: "missing",
      searched: ["/nope/docker"],
      rejected: [],
    });
  });

  it("not found anywhere → missing with the full searched list", () => {
    const loc = locateDocker({ test: false }, { fs: fakeFs({ "/usr": dir() }), uid: UID, home: HOME });
    expect(loc).toEqual({ kind: "missing", searched: dockerCandidates(HOME), rejected: [] });
  });

  it("refuses a non-executable or non-regular file", () => {
    const fs = fakeFs({ ...BASE, "/usr/local/bin/docker": exe({ exec: false }) });
    expect(trustedPath("/usr/local/bin/docker", UID, fs)).toEqual({ ok: false, reason: "/usr/local/bin/docker: not executable" });
    const fs2 = fakeFs({ ...BASE, "/usr/local/bin/docker": dir() });
    expect(trustedPath("/usr/local/bin/docker", UID, fs2)).toEqual({ ok: false, reason: "/usr/local/bin/docker: not a regular file" });
  });
});

describe("PATH and cli-plugins filters", () => {
  it("keeps only trusted PATH entries and reports the dropped ones", () => {
    const fs = fakeFs({ ...BASE, "/usr/local/bin/docker": exe(), "/usr/bin": dir({ gid: 20, mode: 0o775 }) });
    const dropped: string[] = [];
    const path = dockerPath("/usr/local/bin/docker", { fs, uid: UID, home: HOME, onDropped: (r) => dropped.push(r.reason) });
    expect(path.split(":")).toEqual(["/usr/local/bin", "/Applications/Docker.app/Contents/Resources/bin", "/bin", "/usr/sbin", "/sbin"]);
    expect(dropped).toEqual(["/usr/bin: directory /usr/bin is group-writable"]);
  });

  it("puts the CLI's own dir and its resolved target's dir first", () => {
    const fs = fakeFs({
      ...BASE,
      "/usr/local/bin/docker": { kind: "symlink", target: "/Applications/Docker.app/Contents/Resources/bin/docker" },
    });
    expect(dockerPath("/usr/local/bin/docker", { fs, uid: UID, home: HOME }).split(":").slice(0, 2)).toEqual([
      "/usr/local/bin",
      "/Applications/Docker.app/Contents/Resources/bin",
    ]);
  });

  it("reports a group-writable ~/.docker/cli-plugins and accepts a private one", () => {
    const ok = fakeFs({ ...BASE, [`${HOME}/.docker`]: dir({ uid: UID }), [`${HOME}/.docker/cli-plugins`]: dir({ uid: UID, mode: 0o700 }) });
    expect(cliPluginsProblem({ fs: ok, uid: UID, home: HOME })).toBeUndefined();
    const bad = fakeFs({
      ...BASE,
      [`${HOME}/.docker`]: dir({ uid: UID }),
      [`${HOME}/.docker/cli-plugins`]: dir({ uid: UID, gid: 20, mode: 0o777 }),
    });
    expect(cliPluginsProblem({ fs: bad, uid: UID, home: HOME })).toEqual({
      path: `${HOME}/.docker/cli-plugins`,
      reason: `${HOME}/.docker/cli-plugins: directory ${HOME}/.docker/cli-plugins is other-writable`,
    });
  });
});

describe("docker CLI plugins (S3)", () => {
  const home = { [`${HOME}/.docker`]: dir({ uid: UID }), [`${HOME}/.docker/cli-plugins`]: dir({ uid: UID, mode: 0o700 }) };
  const pluginsAt = (d: string) => `${d}/docker-compose`;
  const DD = "/Applications/Docker.app/Contents/Resources/cli-plugins";

  it("checks ~/.docker/cli-plugins, the config's cliPluginsExtraDirs and the system plugin dirs", () => {
    const fs = fakeFs({
      ...BASE,
      ...home,
      [`${HOME}/.docker/config.json`]: {
        kind: "file",
        uid: UID,
        mode: 0o600,
        text: JSON.stringify({ cliPluginsExtraDirs: ["/opt/homebrew/lib/docker/cli-plugins", "relative/x"] }),
      },
    });
    expect(cliPluginDirs({ fs, home: HOME })).toEqual([
      `${HOME}/.docker/cli-plugins`,
      "/opt/homebrew/lib/docker/cli-plugins",
      "/usr/local/lib/docker/cli-plugins",
      "/usr/local/libexec/docker/cli-plugins",
      "/usr/lib/docker/cli-plugins",
      "/usr/libexec/docker/cli-plugins",
    ]);
  });

  it("accepts Docker Desktop's links into its app bundle", () => {
    const fs = fakeFs({
      ...BASE,
      ...home,
      [DD]: dir(),
      [pluginsAt(DD)]: exe(),
      [pluginsAt(`${HOME}/.docker/cli-plugins`)]: { kind: "symlink", uid: UID, target: pluginsAt(DD) },
    });
    expect(cliPluginsProblem({ fs, uid: UID, home: HOME })).toBeUndefined();
  });

  it("rejects a plugin that links into a world-writable folder", () => {
    const fs = fakeFs({
      ...BASE,
      ...home,
      "/tmp": dir({ mode: 0o1777 }),
      "/tmp/docker-compose": exe({ uid: UID }),
      [pluginsAt(`${HOME}/.docker/cli-plugins`)]: { kind: "symlink", uid: UID, target: "/tmp/docker-compose" },
    });
    expect(cliPluginsProblem({ fs, uid: UID, home: HOME })).toEqual({
      path: pluginsAt(`${HOME}/.docker/cli-plugins`),
      reason: `${pluginsAt(`${HOME}/.docker/cli-plugins`)}: parent /tmp is other-writable`,
    });
  });

  it("skips a broken plugin link (the CLI can't run it either)", () => {
    const fs = fakeFs({ ...BASE, ...home, [`${HOME}/.docker/cli-plugins/docker-dev`]: { kind: "symlink", uid: UID, target: "/nope" } });
    expect(cliPluginsProblem({ fs, uid: UID, home: HOME })).toBeUndefined();
  });

  it("rejects a group-writable extra dir from config.json and a group-writable system dir", () => {
    const extra = fakeFs({
      ...BASE,
      ...home,
      [`${HOME}/.docker/config.json`]: { kind: "file", uid: UID, text: JSON.stringify({ cliPluginsExtraDirs: ["/opt/x/cli-plugins"] }) },
      "/opt": dir(),
      "/opt/x": dir(),
      "/opt/x/cli-plugins": dir({ uid: UID, gid: 20, mode: 0o775 }),
    });
    expect(cliPluginsProblem({ fs: extra, uid: UID, home: HOME })?.path).toBe("/opt/x/cli-plugins");
    const system = fakeFs({
      ...BASE,
      "/usr/local/lib": dir(),
      "/usr/local/lib/docker": dir(),
      "/usr/local/lib/docker/cli-plugins": dir({ gid: 20, mode: 0o775 }),
    });
    expect(cliPluginsProblem({ fs: system, uid: UID, home: HOME })?.path).toBe("/usr/local/lib/docker/cli-plugins");
  });

  const infoCli = (stdout: string, code = 0): DockerCli & { calls: string[][] } => {
    const calls: string[][] = [];
    return {
      path: "/usr/local/bin/docker",
      calls,
      run: async (args) => {
        calls.push([...args]);
        return { code, stdout, stderr: "", ms: 1 };
      },
    };
  };

  it("checks every plugin path the CLI reports with trustedPath", async () => {
    const fs = fakeFs({
      ...BASE,
      ...home,
      [DD]: dir(),
      [pluginsAt(DD)]: exe(),
      "/tmp": dir({ mode: 0o1777 }),
      "/tmp/docker-x": exe({ uid: UID }),
    });
    const good = infoCli(JSON.stringify([{ Name: "compose", Path: pluginsAt(DD) }]));
    expect(await pluginPathsProblem(good, {}, { fs, uid: UID })).toEqual({ checked: 1 });
    expect(good.calls).toEqual([["info", "--format", "{{json .ClientInfo.Plugins}}"]]);
    const bad = infoCli(
      JSON.stringify([
        { Name: "compose", Path: pluginsAt(DD) },
        { Name: "x", Path: "/tmp/docker-x", Err: "bad" },
      ]),
    );
    expect(await pluginPathsProblem(bad, {}, { fs, uid: UID })).toEqual({
      checked: 2,
      problem: { path: "/tmp/docker-x", reason: "/tmp/docker-x: parent /tmp is other-writable" },
    });
  });

  it("still reads the plugin list when the engine is down (exit 1)", async () => {
    const fs = fakeFs({ ...BASE, "/tmp": dir({ mode: 0o1777 }), "/tmp/docker-x": exe({ uid: UID }) });
    const r = await pluginPathsProblem(infoCli(JSON.stringify([{ Path: "/tmp/docker-x" }]), 1), {}, { fs, uid: UID });
    expect(r.problem?.path).toBe("/tmp/docker-x");
  });

  it("an unreadable plugin list is reported, not trusted silently", async () => {
    expect(await pluginPathsProblem(infoCli("not json"), {}, { fs: fakeFs(BASE), uid: UID })).toEqual({
      checked: 0,
      problem: { path: "docker info", reason: "the CLI plugin list couldn't be read" },
    });
    expect(await pluginPathsProblem(infoCli("null"), {}, { fs: fakeFs(BASE), uid: UID })).toEqual({ checked: 0 });
  });
});

describe("dockerEnv (D11)", () => {
  const parent = {
    PATH: "/evil/bin:/usr/bin",
    HOME,
    USER: "tester",
    LOGNAME: "tester",
    TMPDIR: "/tmp/x",
    LANG: "en_US.UTF-8",
    DOCKER_CONTEXT: "desktop-linux",
    DOCKER_CONFIG: "/tmp/evil-config",
    COMPOSE_FILE: "/tmp/evil.yml",
    COMPOSE_PROJECT_NAME: "evil",
    OPEN_AGENT_IMAGE: "evil:latest",
    OPEN_AGENT_LAUNCH_TOKEN: "f".repeat(64),
    NODE_OPTIONS: "--require /tmp/x.js",
    ELECTRON_RUN_AS_NODE: "1",
  };

  it("is built from scratch: exact keys, no COMPOSE_*, no parent OPEN_AGENT_*", () => {
    const env = dockerEnv("/usr/local/bin:/usr/bin", parent);
    expect(Object.keys(env).sort()).toEqual(["DOCKER_CONTEXT", "HOME", "LANG", "LOGNAME", "PATH", "TMPDIR", "USER"]);
    expect(env.PATH).toBe("/usr/local/bin:/usr/bin");
  });

  it("adds exactly the compose variables for compose calls; reset is empty unless asked", () => {
    const vars = { port: 41100, token: "a".repeat(64), agentImage: "img-a", searchImage: "img-s", dataVolume: "d", keysVolume: "k" };
    const env = dockerEnv("/usr/bin", parent, vars);
    expect(Object.keys(env).every((k) => ENV_ALLOWLIST.includes(k))).toBe(true);
    expect(env).toMatchObject({
      OPEN_AGENT_PORT: "41100",
      OPEN_AGENT_LAUNCH_TOKEN: "a".repeat(64),
      OPEN_AGENT_IMAGE: "img-a",
      OPEN_AGENT_SEARCH_IMAGE: "img-s",
      OPEN_AGENT_DATA_VOLUME: "d",
      OPEN_AGENT_KEYS_VOLUME: "k",
      OPEN_AGENT_RESET_CREDENTIALS: "",
    });
    expect(dockerEnv("/usr/bin", parent, { ...vars, resetCredentials: true }).OPEN_AGENT_RESET_CREDENTIALS).toBe("1");
    expect(Object.keys(env).some((k) => k.startsWith("COMPOSE_"))).toBe(false);
  });
});

const cliOf = (answers: Record<string, Partial<RunResult>>): DockerCli & { seen: string[][] } => {
  const seen: string[][] = [];
  return {
    path: "/usr/local/bin/docker",
    seen,
    run: async (args) => {
      seen.push([...args]);
      const key = args.slice(0, 2).join(" ");
      const a = answers[key] ?? answers[args[0] ?? ""] ?? { code: 0, stdout: "" };
      return { code: 0, stdout: "", stderr: "", ms: 1, ...a };
    },
  };
};

describe("probeDocker", () => {
  const version = readFileSync(join(FIX, "version.json"), "utf8");
  const info = readFileSync(join(FIX, "info.json"), "utf8").replace(/\s+/g, " ");

  it("reads the recorded Docker Desktop outputs (Compose 5.1.1, desktop-linux)", async () => {
    const cli = cliOf({
      version: { stdout: version },
      "compose version": { stdout: readFileSync(join(FIX, "compose-version.txt"), "utf8") },
      "context show": { stdout: readFileSync(join(FIX, "context-show.txt"), "utf8") },
      info: { stdout: info },
    });
    expect(await probeDocker(cli, {})).toEqual({
      kind: "ok",
      client: "29.3.1",
      server: "29.3.1",
      compose: "5.1.1",
      context: "desktop-linux",
      engine: "docker-desktop",
      arch: "arm64",
      memBytes: 12528578560,
    });
  });

  it("daemon down → stopped with the stderr tail", async () => {
    const cli = cliOf({
      version: {
        code: 1,
        stdout: '{"Client":{"Version":"29.3.1"},"Server":null}',
        stderr: "Cannot connect to the Docker daemon at unix:///x. Is the docker daemon running?",
      },
    });
    expect(await probeDocker(cli, {})).toMatchObject({
      kind: "stopped",
      client: "29.3.1",
      stderrTail: expect.stringContaining("Cannot connect"),
    });
  });

  it("Compose 2.23.0 → compose_old; 2.24.0 passes; a non-Linux server → not_linux", async () => {
    const base = { version: { stdout: version }, info: { stdout: info }, "context show": { stdout: "default" } };
    expect(await probeDocker(cliOf({ ...base, "compose version": { stdout: "2.23.0" } }), {})).toEqual({
      kind: "compose_old",
      compose: "2.23.0",
    });
    expect(await probeDocker(cliOf({ ...base, "compose version": { stdout: "v2.24.0" } }), {})).toMatchObject({
      kind: "ok",
      compose: "v2.24.0",
    });
    const win = cliOf({ version: { stdout: '{"Client":{"Version":"1"},"Server":{"Version":"1","Os":"windows"}}' } });
    expect(await probeDocker(win, {})).toEqual({ kind: "not_linux", os: "windows" });
    expect(composeAtLeast("2.24.1-desktop.1", [2, 24, 0])).toBe(true);
    expect(composeAtLeast("garbage", [2, 24, 0])).toBe(false);
  });

  it("names the engine from info and context", () => {
    expect(engineOf({ OperatingSystem: "Docker Desktop" }, "desktop-linux")).toBe("docker-desktop");
    expect(engineOf({ OperatingSystem: "OrbStack", Name: "orbstack" }, "orbstack")).toBe("orbstack");
    expect(engineOf({ OperatingSystem: "Ubuntu 24.04", Name: "colima" }, "colima")).toBe("colima");
    expect(engineOf({ OperatingSystem: "Rancher Desktop WSL", Name: "lima-rancher-desktop" }, "rancher-desktop")).toBe("rancher-desktop");
    expect(engineOf({ OperatingSystem: "Ubuntu" }, "default")).toBe("other");
  });
});

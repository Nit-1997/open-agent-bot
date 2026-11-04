import { describe, expect, it } from "vitest";
import type { DockerCli } from "../src/main/dockerCli.ts";
import { checkEndpoint, resolveEndpoint } from "../src/main/endpoint.ts";
import type { FsProbe, FsStat } from "../src/main/fsProbe.ts";

const UID = 501;
const nodes: Record<string, FsStat & { real?: string }> = {
  "/Users/tester/.docker/run/docker.sock": { kind: "socket", uid: UID, gid: 20, mode: 0o755 },
  "/var/run/docker.sock": { kind: "socket", uid: UID, gid: 20, mode: 0o755, real: "/Users/tester/.docker/run/docker.sock" },
  "/var/run/root.sock": { kind: "socket", uid: 0, gid: 990, mode: 0o660 },
  "/var/run/other.sock": { kind: "socket", uid: 502, gid: 20, mode: 0o755 },
  "/tmp/plain": { kind: "file", uid: UID, gid: 20, mode: 0o644 },
};
const fs: FsProbe = {
  lstat: (p) => nodes[p],
  stat: (p) => nodes[nodes[p]?.real ?? p],
  realpath: (p) => (nodes[p] ? (nodes[p]?.real ?? p) : undefined),
  executable: () => false,
};

const cli = (host: string | undefined, code = 0): DockerCli & { calls: string[][] } => {
  const calls: string[][] = [];
  return {
    path: "/usr/local/bin/docker",
    calls,
    run: async (args) => {
      calls.push([...args]);
      return { code, stdout: host === undefined ? "" : `${JSON.stringify(host)}\n`, stderr: "", ms: 1 };
    },
  };
};

describe("endpoint (S1)", () => {
  it("DOCKER_HOST wins over the context and no docker call is made", async () => {
    const c = cli("unix:///var/run/other.sock");
    const r = await resolveEndpoint(c, { DOCKER_HOST: "unix:///var/run/docker.sock" }, UID, { allowSystemSocket: false, fs });
    expect(r).toEqual({ ok: true, endpoint: "unix:///var/run/docker.sock", socket: "/Users/tester/.docker/run/docker.sock", owner: UID });
    expect(c.calls).toEqual([]);
  });

  it("reads the current context's endpoint otherwise", async () => {
    const c = cli("unix:///Users/tester/.docker/run/docker.sock");
    expect(await resolveEndpoint(c, {}, UID, { allowSystemSocket: false, fs })).toMatchObject({ ok: true });
    expect(c.calls).toEqual([["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"]]);
  });

  it("refuses tcp, ssh, npipe, a missing path, a regular file and a socket of another uid", () => {
    const o = { allowSystemSocket: false, fs };
    expect(checkEndpoint("tcp://192.168.1.2:2376", UID, o)).toEqual({ ok: false, endpoint: "tcp://192.168.1.2:2376", reason: "not_unix" });
    expect(checkEndpoint("ssh://me@box", UID, o)).toMatchObject({ reason: "not_unix" });
    expect(checkEndpoint("npipe:////./pipe/docker", UID, o)).toMatchObject({ reason: "not_unix" });
    expect(checkEndpoint("unix:///nope.sock", UID, o)).toMatchObject({ reason: "missing" });
    expect(checkEndpoint("unix:///tmp/plain", UID, o)).toMatchObject({ reason: "not_socket" });
    expect(checkEndpoint("unix:///var/run/other.sock", UID, o)).toEqual({
      ok: false,
      endpoint: "unix:///var/run/other.sock",
      reason: "foreign_owner",
      owner: 502,
    });
    expect(checkEndpoint("unix:///var/run/root.sock", UID, { ...o, groups: [20, 990] })).toMatchObject({
      reason: "foreign_owner",
      owner: 0,
    });
  });

  it("test-mode system socket: root-owned with a group the user is in is accepted only with the flag", () => {
    expect(checkEndpoint("unix:///var/run/root.sock", UID, { allowSystemSocket: true, fs, groups: [990] })).toMatchObject({
      ok: true,
      owner: 0,
    });
    expect(checkEndpoint("unix:///var/run/root.sock", UID, { allowSystemSocket: true, fs, groups: [20] })).toMatchObject({ ok: false });
    expect(checkEndpoint("unix:///var/run/other.sock", UID, { allowSystemSocket: true, fs, groups: [20] })).toMatchObject({ ok: false });
  });

  it("a failing context inspect is an explicit unknown endpoint", async () => {
    expect(await resolveEndpoint(cli(undefined, 1), {}, UID, { allowSystemSocket: false, fs })).toEqual({
      ok: false,
      endpoint: "(unknown)",
      reason: "unknown",
    });
  });
});

import type { DockerCli } from "./dockerCli.ts";
import { currentGroups, type FsProbe, realFs } from "./fsProbe.ts";

export type EndpointProblem = "not_unix" | "missing" | "not_socket" | "foreign_owner" | "unknown";
export type EndpointResult =
  | { ok: true; endpoint: string; socket: string; owner: number }
  | { ok: false; endpoint: string; reason: EndpointProblem; owner?: number };

export async function readEndpoint(cli: DockerCli, env: Record<string, string>): Promise<string | undefined> {
  if (env.DOCKER_HOST) return env.DOCKER_HOST;
  const r = await cli.run(["context", "inspect", "--format", "{{json .Endpoints.docker.Host}}"], { env, timeoutMs: 15_000 });
  if (r.code !== 0) return undefined;
  try {
    const v: unknown = JSON.parse(r.stdout.trim());
    return typeof v === "string" ? v : undefined;
  } catch {
    return undefined;
  }
}

export function checkEndpoint(
  endpoint: string,
  uid: number,
  o: { allowSystemSocket: boolean; fs?: FsProbe; groups?: readonly number[] },
): EndpointResult {
  const fs = o.fs ?? realFs;
  if (!endpoint.startsWith("unix://")) return { ok: false, endpoint, reason: "not_unix" };
  const path = endpoint.slice("unix://".length);
  if (!path.startsWith("/")) return { ok: false, endpoint, reason: "missing" };
  const real = fs.realpath(path);
  const st = real ? fs.stat(real) : undefined;
  if (!real || !st) return { ok: false, endpoint, reason: "missing" };
  if (st.kind !== "socket") return { ok: false, endpoint, reason: "not_socket", owner: st.uid };
  if (st.uid === uid) return { ok: true, endpoint, socket: real, owner: st.uid };
  const groups = o.groups ?? currentGroups();
  if (o.allowSystemSocket && st.uid === 0 && groups.includes(st.gid)) return { ok: true, endpoint, socket: real, owner: st.uid };
  return { ok: false, endpoint, reason: "foreign_owner", owner: st.uid };
}

export async function resolveEndpoint(
  cli: DockerCli,
  env: Record<string, string>,
  uid: number,
  o: { allowSystemSocket: boolean; fs?: FsProbe; groups?: readonly number[] },
): Promise<EndpointResult> {
  const endpoint = await readEndpoint(cli, env);
  if (endpoint === undefined) return { ok: false, endpoint: "(unknown)", reason: "unknown" };
  return checkEndpoint(endpoint, uid, o);
}

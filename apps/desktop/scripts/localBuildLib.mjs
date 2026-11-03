import { isAbsolute } from "node:path";
import { parseArgs } from "node:util";

const PREFIX = /^oab-[a-z0-9-]*-$/;
const SHORT_SHA = /^[0-9a-f]{7,12}$/;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;

/** @param {string} [prefix] */
export function localRefs(prefix = "") {
  return { agent: `${prefix}open-agent:local`, search: `${prefix}open-agent-search:local` };
}

/** @param {string[]} argv @param {Record<string, string | undefined>} env */
export function parseLocalBuildArgs(argv, env) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        "tag-prefix": { type: "string" },
        "lock-out": { type: "string" },
        "no-dist": { type: "boolean" },
        docker: { type: "string" },
      },
    }));
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  const prefix = values["tag-prefix"];
  if (prefix !== undefined && !PREFIX.test(prefix))
    return { ok: false, reason: `--tag-prefix must match ^oab-[a-z0-9-]*-$, got ${prefix}` };
  if (prefix === undefined && env.OPEN_AGENT_SHELL_TEST === "1")
    return { ok: false, reason: "OPEN_AGENT_SHELL_TEST=1 needs --tag-prefix oab-…: a test run never writes open-agent:local" };
  const lockOut = values["lock-out"];
  if (lockOut !== undefined && !isAbsolute(lockOut)) return { ok: false, reason: "--lock-out must be an absolute path" };
  if (values.docker !== undefined && !isAbsolute(values.docker)) return { ok: false, reason: "--docker must be an absolute path" };
  return {
    ok: true,
    opts: {
      ...(prefix !== undefined ? { prefix } : {}),
      ...(lockOut !== undefined ? { lockOut } : {}),
      ...(values.docker !== undefined ? { docker: values.docker } : {}),
      dist: !values["no-dist"],
    },
  };
}

/** @param {string} shortSha @param {boolean} dirty */
export function localVersion(shortSha, dirty) {
  if (!SHORT_SHA.test(shortSha)) throw new Error(`expected a short sha, got ${shortSha}`);
  return `local-${shortSha}${dirty ? "-dirty" : ""}`;
}

/** @param {{ agent: string; search: string }} refs @param {string} version */
export function dockerBuilds(refs, version) {
  return [
    ["build", "-f", "packages/core/Dockerfile", "--build-arg", `OPEN_AGENT_VERSION=${version}`, "-t", refs.agent, "."],
    ["build", "--build-arg", `OPEN_AGENT_VERSION=${version}`, "-t", refs.search, "local/searxng"],
  ];
}

/** @param {{ version: string; composeSha256: string; refs: { agent: string; search: string }; ids: { agent: string; search: string } }} o */
export function localLock(o) {
  for (const [name, id] of Object.entries(o.ids))
    if (!IMAGE_ID.test(id)) throw new Error(`the ${name} image Id is not sha256:<64 hex>: ${id}`);
  return {
    schema: 1,
    kind: "local",
    version: o.version,
    composeSha256: o.composeSha256,
    images: { agent: o.refs.agent, search: o.refs.search },
    imageIds: { agent: o.ids.agent, search: o.ids.search },
    pull: false,
  };
}

/** @param {string} arch */
export function hostArchFlag(arch) {
  if (arch === "arm64") return "--arm64";
  if (arch === "x64") return "--x64";
  throw new Error(`dist:local packages for arm64 or x64, not ${arch}`);
}

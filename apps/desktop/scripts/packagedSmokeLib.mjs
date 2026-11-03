export const EXPECTED_FUSES = Object.freeze({
  RunAsNode: false,
  EnableCookieEncryption: false,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true,
  LoadBrowserProcessSpecificV8Snapshot: false,
  GrantFileProtocolExtraPrivileges: false,
});

export const SIZE_BUDGET = Object.freeze({ dmg: 140_000_000, app: 320_000_000, asar: 5_000_000 });

export const IDENTITY = Object.freeze({ CFBundleIdentifier: "ai.worksimulation.openagent", CFBundleName: "Open Agent" });

/** @param {string} text */
export function parseFuses(text) {
  /** @type {Record<string, boolean>} */
  const out = {};
  for (const m of text.matchAll(/^\s*(\w+) is (Enabled|Disabled)\s*$/gm)) out[m[1]] = m[2] === "Enabled";
  return out;
}

/** @param {Record<string, boolean>} fuses */
export function checkFuses(fuses) {
  return Object.entries(EXPECTED_FUSES).flatMap(([name, want]) => {
    if (!(name in fuses)) return [`fuse ${name} is missing`];
    return fuses[name] === want ? [] : [`fuse ${name} is ${fuses[name]}, expected ${want}`];
  });
}

/** @param {Record<string, unknown>} plist @param {string} version */
export function checkPlist(plist, version) {
  const want = { ...IDENTITY, CFBundleShortVersionString: version };
  return Object.entries(want).flatMap(([k, v]) =>
    plist[k] === v ? [] : [`${k} is ${JSON.stringify(plist[k])}, expected ${JSON.stringify(v)}`],
  );
}

/** @param {{ app: number; asar: number; dmg?: number }} sizes */
export function sizeProblems(sizes) {
  const out = [];
  if (sizes.app > SIZE_BUDGET.app) out.push(`.app is ${sizes.app} bytes, budget ${SIZE_BUDGET.app}`);
  if (sizes.asar > SIZE_BUDGET.asar) out.push(`app.asar is ${sizes.asar} bytes, budget ${SIZE_BUDGET.asar}`);
  if (sizes.dmg !== undefined && sizes.dmg > SIZE_BUDGET.dmg) out.push(`dmg is ${sizes.dmg} bytes, budget ${SIZE_BUDGET.dmg}`);
  return out;
}

const OAB = /^oab-[a-z0-9-]+$/;

/** @param {{ stateDir: string; project: string; range: string; docker: string }} t @param {string} home */
export function launchTargetProblems(t, home) {
  const out = [];
  if (!OAB.test(t.project)) out.push(`project must match ^oab-[a-z0-9-]+$, got ${t.project}`);
  const m = /^(\d{5})-(\d{5})$/.exec(t.range);
  const [a, b] = m ? [Number(m[1]), Number(m[2])] : [0, 0];
  if (!m || a < 18000 || b > 19999 || a > b) out.push(`port range must be a-b inside 18000-19999, got ${t.range}`);
  if (!t.stateDir.startsWith("/")) out.push("state dir must be absolute");
  else if (t.stateDir === `${home}/Library` || t.stateDir.startsWith(`${home}/Library/`))
    out.push(`state dir must not be under ${home}/Library`);
  if (!t.docker.startsWith("/")) out.push("docker must be an absolute path");
  return out;
}

/** @param {{ stateDir: string; project: string; range: string; docker: string; services?: string }} t @param {Record<string, string | undefined>} parent */
export function smokeEnv(t, parent) {
  return {
    PATH: parent.PATH ?? "/usr/bin:/bin",
    HOME: parent.HOME ?? "",
    TMPDIR: parent.TMPDIR ?? "/tmp",
    OPEN_AGENT_SHELL_TEST: "1",
    OPEN_AGENT_SHELL_STATE_DIR: t.stateDir,
    OPEN_AGENT_SHELL_PROJECT: t.project,
    OPEN_AGENT_SHELL_DATA_VOLUME: `${t.project}-data`,
    OPEN_AGENT_SHELL_KEYS_VOLUME: `${t.project}-keys`,
    OPEN_AGENT_SHELL_PORT_RANGE: t.range,
    OPEN_AGENT_SHELL_DOCKER: t.docker,
    OPEN_AGENT_SHELL_EXTERNAL_LOG: `${t.stateDir}/external.log`,
    OPEN_AGENT_SHELL_SAVE_PATH: `${t.stateDir}/saved.bin`,
    ...(t.services ? { OPEN_AGENT_SHELL_SERVICES: t.services } : {}),
  };
}

/** @param {string} text */
const records = (text) =>
  text.split("\n").flatMap((line) => {
    try {
      const r = JSON.parse(line);
      return r && Array.isArray(r.argv) && r.phase !== "start" ? [r] : [];
    } catch {
      return [];
    }
  });

/** @param {string[]} argv */
const composeSub = (argv) => {
  if (argv[0] !== "compose") return undefined;
  const flags = new Set(["-p", "-f", "--project-directory", "--env-file", "--ansi"]);
  for (let i = 1; i < argv.length; i++) {
    if (flags.has(argv[i])) i++;
    else return argv[i];
  }
  return undefined;
};

/** @param {string} callsJsonl */
export function composeStopRecorded(callsJsonl) {
  return records(callsJsonl).some((r) => composeSub(r.argv) === "stop" && typeof r.exitCode === "number");
}

/** @param {string} callsJsonl */
export function composeSubcommands(callsJsonl) {
  return records(callsJsonl).flatMap((r) => {
    const sub = composeSub(r.argv);
    return sub ? [sub] : [];
  });
}

/** @param {{ screen?: string; phase?: string; port?: number; servicesVersion?: string } | undefined} status @param {string} log @param {{ localBuild?: boolean }} o */
export function statusProblems(status, log, o) {
  const out = [];
  if (status?.screen !== "app") out.push(`status.json screen is ${status?.screen}, expected app`);
  if (o.localBuild) {
    if (!/^local-[0-9a-f]{7,12}(-dirty)?$/.test(status?.servicesVersion ?? ""))
      out.push(`status.json servicesVersion is ${status?.servicesVersion}, expected local-<sha>`);
    if (!log.includes("[app] title Open Agent — Local build — test"))
      out.push("shell.log has no '[app] title Open Agent — Local build — test' line");
  }
  return out;
}

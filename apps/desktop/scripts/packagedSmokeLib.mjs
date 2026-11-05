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
export const LAUNCH_TIMEOUT_S = Object.freeze({ native: 60, translated: 240, realDocker: 900 });

/** @param {{ explicit?: string, realDocker: boolean, arch?: string, hostArch: string }} o */
export function launchTimeoutMs({ explicit, realDocker, arch, hostArch }) {
  if (explicit !== undefined) return Number(explicit) * 1000;
  if (realDocker) return LAUNCH_TIMEOUT_S.realDocker * 1000;
  const translated = arch === "x86_64" && hostArch === "arm64";
  return (translated ? LAUNCH_TIMEOUT_S.translated : LAUNCH_TIMEOUT_S.native) * 1000;
}

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

/** @param {{ screen?: string; phase?: string; port?: number; servicesVersion?: string } | undefined} status @param {string} log @param {{ localBuild?: boolean; release?: string }} o */
export function statusProblems(status, log, o) {
  const out = [];
  if (status?.screen !== "app") out.push(`status.json screen is ${status?.screen}, expected app`);
  if (o.release !== undefined && status?.servicesVersion !== o.release)
    out.push(`status.json servicesVersion is ${status?.servicesVersion}, expected ${o.release}`);
  if (o.localBuild) {
    if (!/^local-[0-9a-f]{7,12}(-dirty)?$/.test(status?.servicesVersion ?? ""))
      out.push(`status.json servicesVersion is ${status?.servicesVersion}, expected local-<sha>`);
    if (!log.includes("[app] title Open Agent — Local build — test"))
      out.push("shell.log has no '[app] title Open Agent — Local build — test' line");
  }
  return out;
}

const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** @param {string | undefined} v */
export function releaseArgProblems(v) {
  if (v === undefined) return [];
  return RELEASE_VERSION.test(v) ? [] : [`--release must be a version like 1.0.0 or 0.0.0-dryrun.1 (no v), got ${JSON.stringify(v)}`];
}

/** @param {string[]} dmgs @param {string} version */
export function dmgNameProblems(dmgs, version) {
  const want = [`Open-Agent-${version}-arm64.dmg`, `Open-Agent-${version}-x64.dmg`];
  const names = dmgs.map((d) => d.split("/").pop() ?? "");
  const out = names.filter((n) => !want.includes(n)).map((n) => `DMG ${n} is not named ${want.join(" or ")}`);
  if (dmgs.length && out.length === 0) for (const w of want) if (!names.includes(w)) out.push(`no DMG named ${w}`);
  return out;
}

/** @param {{ lock: unknown; lockBytes: Buffer; expectBytes?: Buffer; version: string; composeSha256: string; license: { app?: Buffer; repo: Buffer }; assertLock: (lock: unknown, o: object) => string[] }} o */
export function releaseStaticProblems(o) {
  const out = [];
  const images = /** @type {{ images?: { agent?: unknown } }} */ (o.lock)?.images;
  const dryRun = typeof images?.agent === "string" && images.agent.startsWith("127.0.0.1:");
  for (const p of o.assertLock(o.lock, { version: o.version, composeSha256: o.composeSha256, dryRun }))
    out.push(`services.lock.json: ${p}`);
  if (o.expectBytes && !o.expectBytes.equals(o.lockBytes)) out.push("services.lock.json is not byte-equal to --expect-lock");
  out.push(...licenseProblems(o.license));
  return out;
}

/** @param {{ app?: Buffer; repo: Buffer }} l */
export function licenseProblems(l) {
  if (!l.app) return ["Contents/Resources/LICENSE is missing"];
  return l.app.equals(l.repo) ? [] : ["Contents/Resources/LICENSE differs from the repo LICENSE"];
}

/** @param {{ images: { agent: string; search: string } }} lock @param {string} version */
export const refVersionsFor = (lock, version) => ({ [lock.images.agent]: version, [lock.images.search]: version });

/** @param {string} callsJsonl */
export const pulledRefs = (callsJsonl) => [
  ...new Set(
    records(callsJsonl)
      .filter((r) => r.argv[0] === "pull")
      .map((r) => r.argv[r.argv.length - 1]),
  ),
];

/** @param {string} callsJsonl @param {{ images: { agent: string; search: string } }} lock */
export function pullProblems(callsJsonl, lock) {
  const got = pulledRefs(callsJsonl).sort();
  const want = [lock.images.agent, lock.images.search].sort();
  return JSON.stringify(got) === JSON.stringify(want)
    ? []
    : [`pulled [${got.join(", ")}], expected exactly the bundled [${want.join(", ")}]`];
}

/** @param {string} log */
export const loggedPulls = (log) => [...new Set([...log.matchAll(/\[docker\] pull (\S+) /g)].map((m) => m[1]))];

/** @param {string} log @param {{ images: { agent: string; search: string } }} lock */
export function loggedPullProblems(log, lock) {
  const allowed = new Set([lock.images.agent, lock.images.search]);
  return loggedPulls(log)
    .filter((r) => !allowed.has(r))
    .map((r) => `shell.log pulled ${r}, which is not a bundled ref`);
}

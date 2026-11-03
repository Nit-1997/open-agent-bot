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

#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { isMain, main } from "./cli.mjs";
import { digestOfRef, nameOfRef, PRODUCTION_REFS, parseTag, REPO_SLUG, SIGNER_WORKFLOW, stableJson } from "./releaseLib.mjs";

export function resultProblems(svc, ref, results, { tag, sha }) {
  if (!Array.isArray(results) || results.length === 0) return [`${svc}: gh attestation verify returned no verification results`];
  const want = {
    buildSignerURI: `https://github.com/${SIGNER_WORKFLOW}@refs/tags/${tag}`,
    sourceRepositoryURI: `https://github.com/${REPO_SLUG}`,
    sourceRepositoryRef: `refs/tags/${tag}`,
    sourceRepositoryDigest: sha,
    runnerEnvironment: "github-hosted",
  };
  const hex = digestOfRef(ref).slice("sha256:".length);
  const out = [];
  results.forEach((r, i) => {
    const v = r?.verificationResult;
    const subjects = v?.statement?.subject ?? [];
    if (!subjects.some((s) => s?.digest?.sha256 === hex && s?.name === nameOfRef(ref)))
      out.push(`${svc} result ${i}: no subject ${nameOfRef(ref)} with sha256 ${hex}`);
    const cert = v?.signature?.certificate ?? {};
    for (const [k, value] of Object.entries(want))
      if (cert[k] !== value) out.push(`${svc} result ${i}: certificate ${k} is ${JSON.stringify(cert[k])}, expected ${value}`);
  });
  return out;
}

export function attested({ tag, sha, refs, results }) {
  const problems = [];
  const p = parseTag(tag);
  if (!p.ok) problems.push(p.reason);
  if (!/^[0-9a-f]{40}$/.test(sha ?? "")) problems.push(`--sha ${JSON.stringify(sha)} is not a 40-hex commit`);
  for (const svc of ["agent", "search"])
    if (!PRODUCTION_REFS[svc].test(refs[svc] ?? "")) problems.push(`--${svc} ${refs[svc]} is not a production ref`);
  if (problems.length) return { problems };
  for (const svc of ["agent", "search"]) problems.push(...resultProblems(svc, refs[svc], results[svc], { tag, sha }));
  if (problems.length) return { problems };
  const entry = (svc) => ({ ref: refs[svc], digest: digestOfRef(refs[svc]), verified: true });
  return { problems, value: { agent: entry("agent"), search: entry("search") } };
}

const readResults = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
};

if (isMain(import.meta.url))
  main("attested", () => {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        tag: { type: "string" },
        sha: { type: "string" },
        agent: { type: "string" },
        search: { type: "string" },
        "agent-result": { type: "string" },
        "search-result": { type: "string" },
        out: { type: "string" },
      },
    });
    for (const k of ["tag", "sha", "agent", "search", "agent-result", "search-result", "out"])
      if (!values[k]) throw new Error(`pass --${k}`);
    const r = attested({
      tag: values.tag,
      sha: values.sha,
      refs: { agent: values.agent, search: values.search },
      results: { agent: readResults(values["agent-result"]), search: readResults(values["search-result"]) },
    });
    for (const p of r.problems) process.stderr.write(`attested: ${p}\n`);
    if (r.problems.length) return 1;
    writeFileSync(values.out, stableJson(r.value), { mode: 0o644 });
    process.stdout.write(`attested: ${values.agent} and ${values.search} verified for ${values.tag} at ${values.sha}\n`);
    return 0;
  });

#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { isMain, main } from "./cli.mjs";
import { checkIndex, digestOfRef } from "./releaseLib.mjs";

export function verifyIndex({ ref, version, raw, tagDigest }) {
  const digest = digestOfRef(ref);
  if (!/^sha256:[0-9a-f]{64}$/.test(digest ?? "")) return { ok: false, lines: [`verify-index: ${ref} is not <name>@sha256:<64 hex>`] };
  const r = checkIndex(raw, { digest, tagDigest });
  if (!r.ok) return { ok: false, lines: [`verify-index: ${ref}: ${r.reason}`] };
  return {
    ok: true,
    lines: [
      `verify-index: ${ref} (version ${version})`,
      ...r.platforms.map((p) => `verify-index: platform ${p.platform} ${p.digest}`),
      ...r.attestations.map((a) => `verify-index: dropped unknown/unknown attestation-manifest ${a.digest} → ${a.for}`),
      `verify-index: ${r.platforms.length} platforms, ${r.attestations.length} attestation manifests; tag resolves to the same index`,
    ],
  };
}

if (isMain(import.meta.url))
  main("verify-index", () => {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: { ref: { type: "string" }, version: { type: "string" }, raw: { type: "string" }, "tag-digest": { type: "string" } },
    });
    for (const k of ["ref", "version", "raw", "tag-digest"]) if (!values[k]) throw new Error(`pass --${k}`);
    const r = verifyIndex({ ref: values.ref, version: values.version, raw: readFileSync(values.raw), tagDigest: values["tag-digest"] });
    for (const l of r.lines) (r.ok ? process.stdout : process.stderr).write(`${l}\n`);
    return r.ok ? 0 : 1;
  });

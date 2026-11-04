#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
const CODE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/i;
const GLOB = /[*?{[]/;
const TOKEN = /(?<![\w@./-])(?:\.\/|(?:\.\.\/)+)?cloud(?:\/[^\s"'`,;()<>|&\]}]*)?(?![\w.-])/gi;
const CLOUD_ENTRIES = ["agent", "web", "e2e", "supabase", "deploy", "deploy-config", "README.md", "SECURITY.md"];
const PATH_CALLS = new Set(["join", "resolve"]);
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const TSCONFIG_FIELDS = ["paths", "references", "extends", "include", "files"];

const git = (root, args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const lower = (p) => p.toLowerCase();
const quote = (s) => {
  const q = JSON.stringify(s);
  return q.length > 80 ? `${q.slice(0, 77)}..."` : q;
};
const lineAt = (text, index) => text.slice(0, Math.max(0, index)).split("\n").length;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function cloudEntries(root) {
  const dir = join(root, "cloud");
  const found = existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith(".")) : [];
  return [...new Set([...CLOUD_ENTRIES, ...found])].sort();
}

export function ruleCPattern(entries = CLOUD_ENTRIES) {
  return new RegExp(`(^|[./])cloud\\/(${entries.map(escapeRe).join("|")})\\b`, "i");
}

export function isCloudPath(root, abs) {
  const cloud = lower(join(root, "cloud"));
  const p = lower(resolve(abs));
  return p === cloud || p.startsWith(`${cloud}/`);
}

const insideCloudDir = (file) => /^cloud(\/|$)/i.test(file);

export function listFiles(root) {
  return git(root, ["ls-files", "-co", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean)
    .filter((f) => !insideCloudDir(f) && !/^docs\/superpowers\//.test(f));
}

export function cloudPackageNames(root) {
  const dir = join(root, "cloud");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "package.json")))
    .map((e) => ({ file: `cloud/${e.name}/package.json`, name: JSON.parse(readFileSync(join(dir, e.name, "package.json"), "utf8")).name }));
}

const packageOf = (spec) => {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
};

export function isCloudPackage(name, cloudNames = []) {
  const n = lower(packageOf(name));
  return n === "@oab/cloud" || n.startsWith("@oab/cloud-") || cloudNames.some((c) => lower(c) === n);
}

const isRelative = (spec) => spec === "." || spec === ".." || spec.startsWith("./") || spec.startsWith("../");

export function pathTokens(text) {
  const found = [];
  for (const m of text.matchAll(TOKEN)) {
    const raw = m[0];
    const cut = raw.search(GLOB);
    const literal = cut === -1 ? raw : raw.slice(0, cut);
    if (!/^(\.\/|(\.\.\/)+)?cloud(\/|$)/i.test(literal)) continue;
    found.push({ token: raw, literal, index: m.index });
  }
  return found;
}

function codeImports(text) {
  const info = ts.preProcessFile(text, true, true);
  return info.importedFiles.map((f) => ({ spec: f.fileName, index: f.pos }));
}

function cssImports(text) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  return [...clean.matchAll(/@(?:import|source|plugin)\s+(?:url\(\s*)?["']([^"']+)["']/g)].map((m) => ({ spec: m[1], index: m.index }));
}

function scriptKind(file) {
  if (/\.tsx$/i.test(file)) return ts.ScriptKind.TSX;
  if (/\.(js|mjs|cjs)$/i.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

const isSpecifierLiteral = (node) => {
  const p = node.parent;
  if (!p) return false;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p)) return true;
  if (ts.isLiteralTypeNode(p) && p.parent && ts.isImportTypeNode(p.parent)) return true;
  if (ts.isCallExpression(p) && p.arguments[0] === node) {
    if (p.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
    if (ts.isIdentifier(p.expression) && p.expression.text === "require") return true;
  }
  return false;
};

const calleeName = (expr) => {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return "";
};

const isPathArgument = (node) => {
  const p = node.parent;
  if (!p) return false;
  if (ts.isCallExpression(p) && p.arguments.includes(node)) return PATH_CALLS.has(calleeName(p.expression));
  if (ts.isNewExpression(p) && p.arguments?.includes(node)) return calleeName(p.expression) === "URL";
  return false;
};

export function codeLiterals(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const out = [];
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!isSpecifierLiteral(node)) out.push({ value: node.text, index: node.getStart(source), pathArg: isPathArgument(node) });
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      out.push({ value: node.text, index: node.getStart(source), pathArg: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

export function ruleCMatch(value, pathArg, pattern = ruleCPattern()) {
  const m = pattern.exec(value);
  if (m) return m[0].replace(/^[./]/, "");
  const v = lower(value).replace(/\/+$/, "");
  return lower(value) === "cloud/" || (pathArg && (v === "cloud" || v.endsWith("/cloud"))) ? value : null;
}

export function shellWords(text) {
  const out = [];
  text.split("\n").forEach((line, i) => {
    const code = line.replace(/(^|\s)#.*$/, "$1");
    for (const m of code.matchAll(/[^\s;|&()<>]+/g)) {
      const word = m[0].replace(/["']/g, "");
      if (word) out.push({ word, line: i + 1 });
    }
  });
  return out;
}

export function shellMatch(word, pattern = ruleCPattern()) {
  const m = pattern.exec(word);
  if (m) return m[0].replace(/^[./]/, "");
  const w = lower(word).replace(/\/+$/, "");
  return w === "cloud" || /\/cloud$/.test(w) ? word : null;
}

const stripHashComments = (text) => text.replace(/(^|\s)#.*$/gm, (m, p) => p + " ".repeat(m.length - p.length));

const isDockerfile = (f) => /(^|\/)(Dockerfile[^/]*|[^/]+\.Dockerfile)$/i.test(f);
const isCompose = (f) => /(^|\/)(docker-)?compose[^/]*\.ya?ml$/i.test(f);
const isTsconfig = (f) => /(^|\/)tsconfig[^/]*\.json$/i.test(f);
const shebang = (text) => (text.startsWith("#!") ? text.slice(0, text.indexOf("\n") >>> 0) : "");
const isShellScript = (file, text) => /\.sh$/i.test(file) || (!/\.[^/]+$/.test(file) && /\b(ba|z|da|k)?sh\b/.test(shebang(text)));
const isNodeScript = (file, text) => !/\.[^/]+$/.test(file) && /\bnode\b/.test(shebang(text));
const isBundlerConfig = (f) =>
  /(^|\/)(vite\.config|vitest\.config|next\.config|playwright[^/]*\.config)\.[^/]+$/i.test(f) || /(^|\/)electron-builder\.ya?ml$/i.test(f);

function collectStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) collectStrings([k, v], out);
  return out;
}

export function checkFile({ root, file, text, cloudNames, entries = cloudEntries(root) }) {
  const abs = join(root, file);
  const dir = dirname(abs);
  const hits = [];
  const pattern = ruleCPattern(entries);
  const add = (rule, index, token, resolved, line, shown, field) =>
    hits.push({
      file,
      line: line ?? lineAt(text, index),
      rule,
      token,
      resolved: shown ?? (resolved ? relative(root, resolved) || "." : token),
      ...(field ? { field } : {}),
    });
  const relativeHit = (spec) => (isRelative(spec) ? resolve(dir, spec) : isAbsolute(spec) ? resolve(spec) : null);
  const tokenHits = (rule, body, base, offset = 0) => {
    for (const t of pathTokens(body)) {
      const resolved = resolve(base, t.literal);
      if (isCloudPath(root, resolved)) add(rule, offset + t.index, t.token, resolved);
    }
  };
  const jsonStringHits = (rule, strings, field) => {
    for (const s of strings)
      for (const t of pathTokens(s)) {
        const resolved = resolve(dir, t.literal);
        if (isCloudPath(root, resolved)) add(rule, Math.max(0, text.indexOf(s)), t.token, resolved, undefined, undefined, field);
      }
  };
  const code = CODE.test(file) || isNodeScript(file, text);

  if (code || /\.css$/i.test(file)) {
    const imports = /\.css$/i.test(file) ? cssImports(text) : codeImports(text);
    for (const { spec, index } of imports) {
      const target = relativeHit(spec);
      if (target && isCloudPath(root, target)) add("A", index, spec, target);
      else if (!target && !spec.startsWith("node:") && isCloudPackage(spec, cloudNames)) add("A", index, spec, null);
    }
  }

  if (code) {
    for (const lit of codeLiterals(
      isNodeScript(file, text) ? `${file}.mjs` : file,
      text.replace(/^#!.*/, (l) => " ".repeat(l.length)),
    )) {
      const match =
        ruleCMatch(lit.value, lit.pathArg, pattern) ?? (isAbsolute(lit.value) && isCloudPath(root, lit.value) ? lit.value : null);
      if (match) add("C", lit.index, quote(lit.value), null, undefined, match);
    }
    if (isBundlerConfig(file)) for (const lit of codeLiterals(file, text)) tokenHits("B", lit.value, dir, lit.index);
  }

  if (isShellScript(file, text))
    for (const { word, line } of shellWords(text)) {
      const match = shellMatch(word, pattern) ?? (isAbsolute(word) && isCloudPath(root, word) ? word : null);
      if (match) add("C", 0, quote(word), null, line, match);
    }

  if (/(^|\/)package\.json$/.test(file)) {
    const pkg = JSON.parse(text);
    for (const field of DEPENDENCY_FIELDS)
      for (const [name, version] of Object.entries(pkg[field] ?? {})) {
        if (isCloudPackage(name, cloudNames)) add("B", Math.max(0, text.indexOf(`"${name}"`)), name, null, undefined, undefined, field);
        jsonStringHits("B", [String(version).replace(/^(file|link|workspace):/, "")], field);
      }
    for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) jsonStringHits("B", collectStrings([name, cmd]), `scripts.${name}`);
    jsonStringHits("B", collectStrings(pkg.workspaces ?? []), "workspaces");
    jsonStringHits("B", collectStrings(pkg.files ?? []), "files");
  }

  if (isTsconfig(file)) {
    const { config } = ts.parseConfigFileTextToJson(file, text);
    const c = config ?? {};
    for (const f of TSCONFIG_FIELDS) jsonStringHits("B", collectStrings(c[f] ?? c.compilerOptions?.[f] ?? []), f);
  }

  if (isDockerfile(file)) tokenHits("B", stripHashComments(text), root);
  if (isCompose(file) || /(^|\/)electron-builder\.ya?ml$/i.test(file) || /^local\//.test(file))
    tokenHits("B", stripHashComments(text), dir);

  return hits;
}

function resolveLink(abs) {
  let p = abs;
  for (let i = 0; i < 40; i++) {
    let st;
    try {
      st = lstatSync(p);
    } catch {
      break;
    }
    if (!st.isSymbolicLink()) break;
    const target = readlinkSync(p);
    p = isAbsolute(target) ? target : resolve(dirname(p), target);
  }
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

export function symlinkHits(root) {
  const real = realpathSync(root);
  return git(root, ["ls-files", "-s", "-z"])
    .split("\0")
    .filter(Boolean)
    .map((l) => /^(\d+) [0-9a-f]+ \d+\t(.+)$/.exec(l))
    .filter((m) => m && m[1] === "120000" && !insideCloudDir(m[2]))
    .flatMap(([, , file]) => {
      const target = resolveLink(join(root, file));
      if (!isCloudPath(root, target) && !isCloudPath(real, target)) return [];
      const shown = relative(isCloudPath(real, target) ? real : root, target);
      return [{ file, line: 1, rule: "D", token: readlinkSync(join(root, file)), resolved: shown }];
    });
}

export function packageNameHits(root) {
  return cloudPackageNames(root)
    .filter((p) => typeof p.name !== "string" || !p.name.startsWith("@oab/cloud-"))
    .map((p) => ({ file: p.file, line: 1, rule: "D", token: String(p.name), resolved: "name must start with @oab/cloud-" }));
}

const matchesEntry = (entry, file) =>
  entry.file.endsWith("/**") ? lower(file).startsWith(lower(entry.file.slice(0, -2))) : lower(entry.file) === lower(file);

export function loadAllowlist(root) {
  const path = join(root, "scripts/boundary/allow.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
}

export function allowedBy(allow, hit) {
  if (hit.rule === "A") return null;
  return (
    allow.find(
      (e) =>
        matchesEntry(e, hit.file) &&
        (e.line === undefined || e.line === hit.line) &&
        (e.field === undefined || e.field === hit.field) &&
        (e.token === undefined || e.token === hit.token),
    ) ?? null
  );
}

export function checkRepo(root, { allow = loadAllowlist(root) } = {}) {
  const files = listFiles(root);
  const cloudNames = cloudPackageNames(root)
    .map((p) => p.name)
    .filter((n) => typeof n === "string");
  const entries = cloudEntries(root);
  const hits = [];
  for (const file of files) {
    const abs = join(root, file);
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const buf = readFileSync(abs);
    if (buf.includes(0)) continue;
    hits.push(...checkFile({ root, file, text: buf.toString("utf8"), cloudNames, entries }));
  }
  hits.push(...symlinkHits(root), ...packageNameHits(root));
  const violations = [];
  const allowed = [];
  for (const h of hits) {
    const entry = allowedBy(allow, h);
    if (entry) allowed.push({ ...h, reason: entry.reason });
    else violations.push(h);
  }
  return { files: files.length, violations, allowed };
}

const format = (h) => `${h.file}:${h.line} ${h.rule} ${h.token} -> ${h.resolved}`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { root: { type: "string" }, "show-allowed": { type: "boolean" } } });
  const root = resolve(values.root ?? join(HERE, "../.."));
  const { files, violations, allowed } = checkRepo(root);
  process.stdout.write(`cloud-boundary: ${files} files, ${violations.length} violations\n`);
  for (const v of violations) process.stdout.write(`VIOLATION ${format(v)}\n`);
  if (values["show-allowed"]) for (const a of allowed) process.stdout.write(`ALLOWED ${format(a)} (${a.reason})\n`);
  process.exit(violations.length ? 1 : 0);
}

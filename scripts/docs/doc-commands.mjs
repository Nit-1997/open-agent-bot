import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const MANIFEST_FILE = join(REPO, "scripts/docs/doc-commands.json");
export const COVERED_FILES = Object.freeze(["docs/INSTALL.md"]);
export const MODES = Object.freeze(["run", "env", "subst", "owner"]);
export const CWDS = Object.freeze(["downloads"]);
const SHELL_INFO = new Set(["bash", "sh", "zsh"]);
const CLONE_URL = "https://github.com/Nit-1997/open-agent-bot";
const SIGNER = "Nit-1997/open-agent-bot/.github/workflows/release.yml";

export function extractCommands(text, file) {
  const lines = text.split("\n");
  const out = [];
  let fence;
  let pending;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!fence) {
      const open = /^(\s*)(`{3,}|~{3,})\s*([\w+-]*)/.exec(raw);
      if (open) fence = { indent: open[1].length, mark: open[2], shell: SHELL_INFO.has(open[3].toLowerCase()) };
      continue;
    }
    const close = new RegExp(`^\\s*${fence.mark[0] === "`" ? "`" : "~"}{${fence.mark.length},}\\s*$`);
    if (close.test(raw)) {
      if (pending) out.push(pending);
      fence = undefined;
      pending = undefined;
      continue;
    }
    if (!fence.shell) continue;
    const body = raw.slice(Math.min(fence.indent, raw.length - raw.trimStart().length)).trim();
    if (pending) {
      const cont = body.endsWith("\\");
      pending.command = `${pending.command} ${cont ? body.slice(0, -1).trim() : body}`.trim();
      if (!cont) {
        out.push(pending);
        pending = undefined;
      }
      continue;
    }
    const line = body.replace(/^\$ /, "");
    if (!line || line.startsWith("#")) continue;
    if (line.endsWith("\\")) pending = { file, line: i + 1, command: line.slice(0, -1).trim() };
    else out.push({ file, line: i + 1, command: line });
  }
  return out;
}

export function loadManifest(path = MANIFEST_FILE) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const keyOf = (e) => `${e.file}: ${e.command}`;

export function manifestProblems(manifest, substNames) {
  const out = [];
  const seen = new Set();
  for (const e of manifest.commands ?? []) {
    const k = keyOf(e);
    if (seen.has(k)) out.push(`listed twice: ${k}`);
    seen.add(k);
    if (!MODES.includes(e.mode)) out.push(`${k}: unknown mode ${e.mode}`);
    if (e.mode === "owner" && !e.reason) out.push(`${k}: owner needs a reason`);
    if (e.mode === "subst" && !(e.subst?.length > 0)) out.push(`${k}: subst needs substitutions`);
    if (e.subst && e.mode !== "subst") out.push(`${k}: substitutions need mode subst`);
    for (const s of e.subst ?? []) if (!substNames.includes(s)) out.push(`${k}: unknown substitution ${s}`);
    if (e.expectExit !== undefined && !e.reason) out.push(`${k}: expectExit needs a reason`);
    if (e.cwd !== undefined && !CWDS.includes(e.cwd)) out.push(`${k}: unknown cwd ${e.cwd}`);
  }
  return out;
}

export function coverage(extracted, manifest, files) {
  const documented = new Set(extracted.filter((c) => files.includes(c.file)).map(keyOf));
  const listed = new Set((manifest.commands ?? []).map(keyOf));
  return {
    missing: [...documented].filter((k) => !listed.has(k)),
    extra: [...listed].filter((k) => !documented.has(k)),
  };
}

const OPERATORS = ["&&", "||", ";;", ";", "|", "&", "(", ")"];
const REDIRECTS = [">>", ">&", "<&", ">|", "&>", "<<", ">", "<"];

export function tokenize(line) {
  const commands = [];
  let cur = newCommand(0);
  let word;
  let expectTarget;
  let i = 0;
  const startWord = () => {
    if (!word) word = { text: "", raw: "", quoted: false, cmdsub: false, tilde: false, params: [], start: i };
  };
  const endWord = () => {
    if (!word) return;
    word.raw = line.slice(word.start, i);
    if (expectTarget) {
      cur.redirects.push({ op: expectTarget, target: word.text, word });
      expectTarget = undefined;
    } else if (cur.words.length === 0 && !word.quoted && /^[A-Za-z_][A-Za-z0-9_]*=/.test(word.text)) cur.assigns.push(word);
    else cur.words.push(word);
    word = undefined;
  };
  const dollar = () => {
    const rest = line.slice(i + 1);
    if (rest.startsWith("(")) {
      word.cmdsub = true;
      const end = line.indexOf(")", i);
      const stop = end < 0 ? line.length : end + 1;
      word.text += line.slice(i, stop);
      i = stop;
      return;
    }
    const m = /^(\{[^}]*\}|[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/.exec(rest);
    if (m) {
      word.params.push(m[1].replace(/^\{|\}$/g, "").replace(/[^A-Za-z0-9_].*$/, ""));
      word.text += `$${m[1]}`;
      i += 1 + m[1].length;
      return;
    }
    word.text += "$";
    i++;
  };
  while (i < line.length) {
    const ch = line[i];
    if (ch === " " || ch === "\t") {
      endWord();
      i++;
      continue;
    }
    if (!word && ch === "#") break;
    const red = REDIRECTS.find((r) => line.startsWith(r, i));
    if (red) {
      if (word && /^\d+$/.test(word.text) && !word.quoted) word = undefined;
      else endWord();
      if (expectTarget) return { ok: false, error: `redirection without a target at ${i}` };
      expectTarget = red;
      i += red.length;
      continue;
    }
    const op = OPERATORS.find((o) => line.startsWith(o, i));
    if (op) {
      endWord();
      if (expectTarget) return { ok: false, error: `redirection without a target at ${i}` };
      if (op === "(" || op === ")") {
        cur.subshell = true;
        i++;
        continue;
      }
      cur.op = op;
      cur.end = i;
      commands.push(cur);
      i += op.length;
      cur = newCommand(i);
      continue;
    }
    startWord();
    if (ch === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) return { ok: false, error: "unterminated single quote" };
      word.text += line.slice(i + 1, end);
      word.quoted = true;
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      word.quoted = true;
      i++;
      let closed = false;
      while (i < line.length) {
        const c = line[i];
        if (c === '"') {
          closed = true;
          i++;
          break;
        }
        if (c === "\\" && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) {
          word.text += line[i + 1];
          i += 2;
          continue;
        }
        if (c === "`") {
          word.cmdsub = true;
          word.text += c;
          i++;
          continue;
        }
        if (c === "$") {
          dollar();
          continue;
        }
        word.text += c;
        i++;
      }
      if (!closed) return { ok: false, error: "unterminated double quote" };
      continue;
    }
    if (ch === "\\") {
      if (i + 1 < line.length) word.text += line[i + 1];
      word.quoted = true;
      i += 2;
      continue;
    }
    if (ch === "`") {
      word.cmdsub = true;
      word.text += ch;
      i++;
      continue;
    }
    if (ch === "$") {
      dollar();
      continue;
    }
    if (ch === "~" && word.text === "" && !word.quoted) word.tilde = true;
    word.text += ch;
    i++;
  }
  endWord();
  if (expectTarget) return { ok: false, error: "redirection without a target" };
  cur.end = line.length;
  if (cur.words.length || cur.assigns.length || cur.redirects.length || cur.subshell) commands.push(cur);
  return { ok: true, commands };
}

function newCommand(start) {
  return { words: [], assigns: [], redirects: [], start, end: start, op: undefined, subshell: false };
}

const BEFORE = String.raw`(?<=^|[\s='"]|\\n|&&|;|\|)`;
const AFTER = String.raw`(?=$|[\s='"]|\\n|&&|;|\|)`;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const exact = (literal) => new RegExp(`${BEFORE}${esc(literal)}${AFTER}`, "g");

export function substitutionRules(ctx) {
  const v = esc(ctx.guideVersion);
  return {
    "clone-url": {
      pattern: exact(CLONE_URL),
      replace: (text, offset, whole) => {
        const rest = whole.slice(offset + text.length);
        const target = /^\s*($|&&|;|\|)/.test(rest);
        return target ? `file://${ctx.repo} open-agent-bot` : `file://${ctx.repo}`;
      },
    },
    "clone-branch": { pattern: exact(`--branch v${ctx.guideVersion}`), replace: () => `--branch ${ctx.branch}` },
    "install-path": { pattern: exact('"/Applications/Open Agent.app"'), replace: () => `"${ctx.installApp}"` },
    "local-url": {
      pattern: new RegExp(`${BEFORE}${esc("http://127.0.0.1:3000")}(?=$|[\\s='"/]|\\\\n|&&|;|\\|)`, "g"),
      replace: () => `http://127.0.0.1:${ctx.port}`,
    },
    "agent-ref": {
      pattern: new RegExp(`${BEFORE}ghcr\\.io/nit-1997/open-agent@sha256:(?:[0-9a-f]{64}|<agent-digest>)${AFTER}`, "g"),
      replace: () => ctx.refs.agent,
    },
    "search-ref": {
      pattern: new RegExp(`${BEFORE}ghcr\\.io/nit-1997/open-agent-search@sha256:(?:[0-9a-f]{64}|<search-digest>)${AFTER}`, "g"),
      replace: () => ctx.refs.search,
    },
    dmg: {
      pattern: new RegExp(`${BEFORE}Open-Agent-${v}-(arm64|x64)\\.dmg${AFTER}`, "g"),
      replace: (text) => text.replace(`Open-Agent-${ctx.guideVersion}-`, `Open-Agent-${ctx.dryVersion}-`),
    },
  };
}

export function substitute(command, names, rules) {
  let text = command;
  const applied = [];
  const missing = [];
  for (const name of names) {
    const rule = rules[name];
    if (!rule) {
      missing.push(name);
      continue;
    }
    let hit = false;
    text = text.replace(rule.pattern, (m, ...rest) => {
      hit = true;
      const offset = rest.find((x) => typeof x === "number");
      return rule.replace(m, offset, text);
    });
    (hit ? applied : missing).push(name);
  }
  return { text, applied, missing };
}

const inside = (p, root) => p === root || p.startsWith(`${root}/`);
const isUrl = (s) => /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);
const ALWAYS_OWNER = new Map([
  ["eval", "eval"],
  ["exec", "exec"],
  ["sudo", "sudo"],
  ["xargs", "xargs"],
  ["source", "source (.)"],
  [".", "source (.)"],
  ["brew", "brew changes the real Mac"],
  ["colima", "colima changes the real Mac"],
  ["gh", "gh needs a signed-in GitHub account"],
]);
const DOCKER_OBJECTS = new Set(["image", "volume", "container", "network", "builder", "buildx", "context"]);
const DOCKER_REMOVE = new Set(["rm", "remove", "prune", "rmi"]);
const COMPOSE_SUBS = new Set(["up", "down", "pull", "ps", "logs", "config"]);
const COMPOSE_BANNED = ["-p", "--project-name", "-f", "--file", "--project-directory", "--env-file"];
const CURL_FLAGS = new Set(["-f", "-s", "-S", "-fsS", "-fs", "-sS", "-sSf", "-i", "-I", "--fail", "--silent", "--show-error", "--head"]);
const base = (w) => w.split("/").pop();

function forcedReason(cmd, ctx) {
  if (cmd.subshell) return "subshell";
  if (cmd.op === "&") return "background job (&)";
  const all = [...cmd.assigns, ...cmd.words, ...cmd.redirects.map((r) => r.word)];
  for (const w of all) {
    if (w.cmdsub) return "command substitution";
    if (w.params.includes("HOME")) return "$HOME";
    if (w.params.length) return `parameter expansion $${w.params[0]}`;
    if (w.tilde) return "~ (the real home folder)";
  }
  const argv = cmd.words.map((w) => w.text);
  const first = argv.length ? base(argv[0]) : "";
  if (first === "rm") return "rm";
  if (ALWAYS_OWNER.has(argv[0])) return ALWAYS_OWNER.get(argv[0]);
  if (SHELLS.has(first) && argv.includes("-c")) return `${first} -c`;
  if (first === "cd" && argv[1] === "..") return "cd .. leaves the scratch dir";
  const docker = first === "docker" ? dockerForced(argv) : undefined;
  if (docker) return docker;
  for (const w of all) {
    const parts = [w.text, ...w.text.split("=").slice(1)];
    for (const p of parts) {
      if (isUrl(p)) continue;
      if (p.startsWith("/") && !inside(p, ctx.dir)) return `absolute path outside the scratch dir: ${p}`;
      if (/(^|\/)\.\.(\/|$)/.test(p)) return `.. leaves the scratch dir: ${p}`;
      if (/(^|\/)Library(\/|$)/.test(p) && !inside(p, ctx.dir)) return `Library path: ${p}`;
    }
  }
  return undefined;
}

function dockerForced(argv) {
  const i = 1;
  if (argv[i]?.startsWith("-")) return `docker ${argv[i].split("=")[0]}`;
  const sub = argv[i];
  if (sub === "rm" || sub === "rmi" || sub === "logout") return `docker ${sub}`;
  if (sub === "system" && argv[i + 1] === "prune") return "docker system prune";
  if (DOCKER_OBJECTS.has(sub) && DOCKER_REMOVE.has(argv[i + 1])) return `docker ${sub} ${argv[i + 1]}`;
  if (sub === "compose")
    for (const a of argv.slice(i + 1)) {
      const name = a.split("=")[0];
      if (COMPOSE_BANNED.includes(name)) return `docker compose ${name}`;
      if (/^-[A-Za-z]+$/.test(a) && /[pf]/.test(a.slice(1))) return `docker compose -${a.includes("p") ? "p" : "f"}`;
    }
  return undefined;
}

function allowed(cmd, ctx, cwd) {
  const argv = cmd.words.map((w) => w.text);
  const notAllowed = {
    ok: false,
    reason: `not allowlisted: ${argv.slice(0, argv[0] === "docker" && argv[1] === "compose" ? 3 : 2).join(" ")}`,
  };
  if (cmd.assigns.length) return { ok: false, reason: `variable assignment: ${cmd.assigns[0].text}` };
  if (argv[0] === "printf") {
    const r = cmd.redirects;
    if (r.length === 1 && r[0].op === ">" && r[0].target === ".env" && cwd === ctx.clone && argv.length === 2) return { ok: true, cwd };
    return notAllowed;
  }
  if (cmd.redirects.length) return { ok: false, reason: `redirection ${cmd.redirects[0].op} ${cmd.redirects[0].target}` };
  const [a0, a1] = argv;
  if (a0 === "git" && a1 === "clone") {
    const pos = [];
    for (let i = 2; i < argv.length; i++) {
      if (argv[i] === "--branch" || argv[i] === "-b" || argv[i] === "--depth") i++;
      else if (argv[i].startsWith("-")) return notAllowed;
      else pos.push(argv[i]);
    }
    if (pos.length !== 2 || pos[0] !== `file://${ctx.repo}`) return notAllowed;
    if (pos[1].startsWith("/") || !inside(resolve(cwd, pos[1]), ctx.dir) || resolve(cwd, pos[1]) === ctx.dir) return notAllowed;
    return { ok: true, cwd };
  }
  if (a0 === "git" && (a1 === "fetch" || a1 === "checkout")) return inside(cwd, ctx.clone) ? { ok: true, cwd } : notAllowed;
  if (a0 === "cd") {
    if (argv.length !== 2) return notAllowed;
    const to = resolve(cwd, argv[1]);
    return inside(to, ctx.dir) ? { ok: true, cwd: to } : { ok: false, reason: `cd leaves the scratch dir: ${argv[1]}` };
  }
  if (a0 === "docker" && a1 === "compose") {
    if (!COMPOSE_SUBS.has(argv[2])) return notAllowed;
    if (!inside(cwd, ctx.clone)) return { ok: false, reason: "docker compose outside the clone" };
    return { ok: true, cwd, docker: true };
  }
  if (a0 === "docker" && ((a1 === "image" && argv[2] === "ls") || a1 === "ps")) return { ok: true, cwd, docker: true };
  if (a0 === "curl") {
    const urls = argv.slice(1).filter((a) => !a.startsWith("-"));
    const flags = argv.slice(1).filter((a) => a.startsWith("-"));
    if (urls.length === 1 && localUrl(urls[0], ctx) && flags.every((f) => CURL_FLAGS.has(f))) return { ok: true, cwd };
    return notAllowed;
  }
  if (a0 === "open" && argv.length === 2 && localUrl(a1, ctx)) return { ok: true, cwd, rewrite: `curl -fsS ${a1}` };
  if (a0 === "shasum") {
    const want = ["shasum", "-a", "256", "-c", "SHA256SUMS"];
    const extra = argv.slice(5);
    const shape = want.every((w, i) => argv[i] === w) && extra.every((e) => e === "--ignore-missing") && extra.length <= 1;
    return shape && cwd === ctx.downloads ? { ok: true, cwd } : notAllowed;
  }
  if (a0 === "xattr") {
    const shape = (argv.length === 3 && a1 === "-l") || (argv.length === 4 && a1 === "-dr" && argv[2] === "com.apple.quarantine");
    return shape && argv.at(-1) === ctx.installApp ? { ok: true, cwd } : notAllowed;
  }
  return notAllowed;
}

const localUrl = (u, ctx) => new RegExp(`^http://127\\.0\\.0\\.1:${ctx.port}(/\\S*)?$`).test(u);

export function classify(text, ctx, cwd) {
  const t = tokenize(text);
  if (!t.ok) return { runnable: false, reason: `can't parse: ${t.error}` };
  for (const cmd of t.commands) {
    const r = forcedReason(cmd, ctx);
    if (r) return { runnable: false, reason: r };
  }
  let at = cwd;
  const docker = [];
  let asRun = text;
  const rewrites = [];
  for (const cmd of t.commands) {
    const r = allowed(cmd, ctx, at);
    if (!r.ok) return { runnable: false, reason: r.reason };
    if (r.docker) docker.push(at);
    if (r.rewrite) rewrites.push({ start: cmd.start, end: cmd.end, text: r.rewrite });
    at = r.cwd;
  }
  for (const w of rewrites.reverse()) {
    const lead = asRun.slice(w.start, w.end).match(/^\s*/)[0];
    const trail = asRun.slice(w.start, w.end).match(/\s*$/)[0];
    asRun = `${asRun.slice(0, w.start)}${lead}${w.text}${trail}${asRun.slice(w.end)}`;
  }
  return { runnable: true, asRun, cwdAfter: at, docker };
}

export function forbiddenNames(text, ctx) {
  const t = tokenize(text);
  const words = t.ok ? t.commands.flatMap((c) => c.words.map((w) => w.text)) : [];
  if (words.includes("open-agent")) return "names the open-agent project";
  if (/(?<![\w.-])3000(?![\w.-])/.test(text.replaceAll(ctx.dir, ""))) return "names port 3000";
  for (const v of ["open-agent-data", "open-agent-keys"]) if (text.includes(v)) return `names the ${v} volume`;
  if (text.replaceAll(ctx.dir, "").includes("/Applications")) return "names /Applications";
  return undefined;
}

export function guideVersion(text) {
  return /^Version in this guide: (\d+\.\d+\.\d+)$/m.exec(text)?.[1];
}

const VERSIONED = [
  /Open-Agent-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-(?:arm64|x64)\.dmg/g,
  /--branch v(\d+\.\d+\.\d+(?:-rc\.\d+)?)/g,
  /refs\/tags\/v(\d+\.\d+\.\d+(?:-rc\.\d+)?)/g,
  /ghcr\.io\/nit-1997\/open-agent(?:-search)?:v?(\d+\.\d+\.\d+(?:-rc\.\d+)?)/g,
];

export function versionProblems(docs, version) {
  const out = new Set();
  for (const { name, text } of docs)
    for (const re of VERSIONED)
      for (const m of text.matchAll(re)) if (m[1] !== version) out.add(`${name}: ${m[0]} uses ${m[1]}, not ${version}`);
  return [...out];
}

export function imageTagProblems(text) {
  return [...new Set([...text.matchAll(/ghcr\.io\/nit-1997\/open-agent(?:-search)?:[^\s'"`)@]+/g)].map((m) => m[0]))].map(
    (r) => `${r} names an image by tag`,
  );
}

export function attestationProblems(text, version) {
  const need = [`--signer-workflow ${SIGNER}`, `--source-ref refs/tags/v${version}`, "--deny-self-hosted-runners"];
  const out = [];
  text.split("\n").forEach((line, i) => {
    if (!/gh attestation verify\s+\S/.test(line)) return;
    const missing = need.filter((n) => !line.includes(n));
    if (missing.length) out.push(`line ${i + 1}: gh attestation verify lacks ${missing.join(", ")}`);
  });
  return out;
}

export function htmlProblems(text) {
  const out = [];
  let fence;
  text.split("\n").forEach((line, i) => {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = undefined;
      return;
    }
    if (fence) return;
    const prose = line.replace(/(`+)[^`]*?\1/g, "");
    for (const m of prose.matchAll(/<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?>/g)) out.push(`line ${i + 1}: ${m[0]}`);
  });
  return out;
}

export function tsvRow(fields) {
  return fields
    .map((f) =>
      String(f ?? "")
        .replaceAll("\t", "\\t")
        .replaceAll("\n", "\\n"),
    )
    .join("\t");
}

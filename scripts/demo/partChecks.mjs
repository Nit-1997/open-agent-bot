import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEMO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)));

export const MILESTONES = Object.freeze({
  m5: Object.freeze({ dir: join(DEMO_ROOT, "m5"), parts: 10, ports: Object.freeze([[18500, 18549]]), strict: false }),
  m6: Object.freeze({
    dir: join(DEMO_ROOT, "m6"),
    parts: 9,
    ports: Object.freeze([
      [18600, 18649],
      [18300, 18300],
      [18800, 18800],
    ]),
    strict: true,
  }),
});

export const partsOf = (milestone) => Array.from({ length: MILESTONES[milestone].parts }, (_, n) => `part-${n}.sh`);
export const libOf = (milestone) => join(MILESTONES[milestone].dir, "lib.sh");

export const PARTS_DIR = MILESTONES.m5.dir;
export const LIB = libOf("m5");
export const PARTS = Object.freeze(partsOf("m5"));
export const PORT_MIN = 18500;
export const PORT_MAX = 18549;

const OAB = /^"?oab-[a-z0-9-]+"?$/;

export function stripComment(line) {
  let quote;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = undefined;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "\\") i++;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

const codeLines = (text) =>
  text
    .split("\n")
    .map((l, i) => ({ n: i + 1, text: stripComment(l) }))
    .filter((l) => l.text.trim());

function portsOf(line) {
  const out = [];
  const push = (v) => out.push(Number(v));
  for (const m of line.matchAll(/(?:127\.0\.0\.1|localhost|0\.0\.0\.0):(\d{2,5})\b/g)) push(m[1]);
  for (const m of line.matchAll(/\b[A-Z_]*PORT=(\d+)/g)) push(m[1]);
  for (const m of line.matchAll(/--port[ =](\d+)/g)) push(m[1]);
  for (const m of line.matchAll(/(?:--range[ =]|RANGE=)(\d+)-(\d+)/g)) {
    push(m[1]);
    push(m[2]);
  }
  for (const m of line.matchAll(/\b(1[89]\d{3})\b/g)) push(m[1]);
  return out;
}

const COMPOSE_CONFIG = /(?:^|\s)config(?=\s|$)/;

function composeProblem(line, { configExempt }) {
  for (const m of line.matchAll(/docker compose\b(.*?)(?=$|&&|\|\||;|\|)/g)) {
    const args = m[1].trim();
    if (/^(ls|version)\b/.test(args)) continue;
    if (configExempt && COMPOSE_CONFIG.test(args)) continue;
    const before = line.slice(0, m.index);
    const env = /COMPOSE_PROJECT_NAME=(\S+)\s+$/.exec(before)?.[1];
    const flag = /(?:^|\s)(?:-p|--project-name)[ =](\S+)/.exec(args)?.[1];
    const name = flag ?? env;
    if (!name || !OAB.test(name)) return `docker compose must name an oab- project with -p (got ${name ?? "none"})`;
  }
  return undefined;
}

const REMOVAL =
  /docker\s+(?:rm|rmi|(?:image|volume|container|network)\s+(?:rm|remove|prune)|buildx\s+(?:rm|prune)|system\s+prune|builder\s+prune)\b[^;&|]*(?:\|[^;&]*)?/g;

function removalProblem(line) {
  for (const m of line.matchAll(REMOVAL)) {
    if (/system\s+prune|builder\s+prune|buildx\s+prune|(?:image|volume|container|network)\s+prune/.test(m[0]))
      return `prune is never allowed: ${m[0].trim()}`;
    if (!/oab-|\$\(m\d+_images\)/.test(m[0])) return `removal must name an oab- resource: ${m[0].trim()}`;
  }
  return undefined;
}

function libraryProblem(line) {
  if (!/(?:\$HOME|\$\{HOME\}|~)\/Library/.test(line)) return undefined;
  if (!/\bstat -f\b/.test(line)) return "only stat may read $HOME/Library";
  if (/\b(rm|mkdir|touch|cp|mv|ditto|tee|ln|chmod|chown|xattr)\b/.test(line)) return "no writes under $HOME/Library";
  for (const m of line.matchAll(/>{1,2}\s*("[^"]*"|\S+)/g))
    if (!/^"?\$\{?DEMO_DIR\}?\//.test(m[1]) && m[1] !== "/dev/null" && !/^&\d$/.test(m[1]))
      return `$HOME/Library line redirects to ${m[1]}`;
  return undefined;
}

function liveProblem(line) {
  if (/docker\s+(?:exec|inspect|logs|stop|start|restart|kill|rm|pause|cp|attach)\b[^;&|]*open-agent-bot/.test(line))
    return "never act on the live open-agent-bot containers";
  if (/(?:-p|--project-name)[ =]"?open-agent/.test(line)) return "never name the open-agent or open-agent-bot project";
  return undefined;
}

const DOWN_VOLUMES = /\bdown\b[^;&|]*\s(?:-v|--volumes)\b/;
const INSPECT = /\bdocker\s+(?:(?:image|container|volume|network)\s+)?inspect\b([^|;&)]*)/g;
const FORMAT_ARG = /(?:--format|-f)(?:=|\s+)('[^']*'|\\?"(?:[^"\\]|\\.)*?\\?"|\S+)/g;
const ENV_FILE_PATH = /\.env-|env-files\//;
const CONTENT_TOOLS =
  /\b(?:cat|grep|egrep|fgrep|sed|awk|cut|head|tail|less|more|xxd|od|strings|base64|jq|tee|diff|cmp)\b[^|;&]*?(?:\.env-|env-files\/)/;
const GITHUB_VARS = /\b(?:GITHUB_ACTIONS|RUNNER_TEMP|GITHUB_WORKSPACE)\b/;

function inspectProblem(line, inLib) {
  for (const m of line.matchAll(INSPECT)) {
    const args = m[1];
    if (!/(?:^|\s)(?:--format|-f)(?:=|\s)/.test(args)) return "docker inspect needs --format";
    const operands = args
      .replace(FORMAT_ARG, " ")
      .split(/\s+/)
      .filter((w) => w && !w.startsWith("-") && !/^\\?"?$/.test(w));
    if (operands.length === 0) return "docker inspect must name its object";
    for (const o of operands) {
      const bare = o.replace(/^\\?["']|\\?["']$/g, "");
      if (/^oab-/.test(bare)) continue;
      if (inLib && /^\$\{?\w/.test(bare)) continue;
      return `docker inspect must name an oab- object (got ${o})`;
    }
  }
  return undefined;
}

function configProblem(line) {
  const m = /docker compose\b[^|;&]*?\sconfig(?=\s|$)/.exec(line);
  if (!m) return undefined;
  const rest = line.slice(m.index + m[0].length);
  const piped = /^([^|;&]*)\|\s*(?:jq -r \.name|jq_names_ports|jq_names)(?=$|[\s"';)|])/.exec(rest);
  if (!piped) return "compose config must pipe into a names-only jq filter (jq -r .name, jq_names, jq_names_ports)";
  if (!/--no-env-resolution\b/.test(piped[1])) return "compose config must run with --no-env-resolution";
  return undefined;
}

export function strictProblems(line, { inLib = false } = {}) {
  const out = [];
  if (!inLib && DOWN_VOLUMES.test(line)) out.push("down -v only through lib.sh's preflight-guarded down_* helpers");
  if (/\bdocker\s+(?:container\s+)?(?:exec|logs)\b/.test(line) || /docker compose\b[^|;&]*\s(?:exec|logs)\b/.test(line))
    out.push("no docker exec or logs");
  for (const p of [inspectProblem(line, inLib), configProblem(line)]) if (p) out.push(p);
  if (/(?:docker compose|_compose)\b[^|;&]*\sup\b[^|;&]*\s--build\b/.test(line) && !/\|\s*redact_build\b/.test(line))
    out.push("compose up --build output goes through redact_build before it is saved");
  if (/=\s*"?\$\(scratch\b/.test(line) && !/\|\|\s*exit 1\s*$/.test(line)) out.push("a scratch dir assignment needs || exit 1");
  if (/\bset\s+-[a-z]*x|\bset\s+-o\s+xtrace\b/.test(line)) out.push("no set -x");
  if (/(?:^|[\s;&|(])(?:env|printenv)(?=$|[\s;&|)])/.test(line) || /\b(?:export|declare)\s+-p\b/.test(line))
    out.push("no env, printenv, export -p or declare -p");
  if (GITHUB_VARS.test(line) && !/^\s*unset\b/.test(line)) out.push("never set GITHUB_ACTIONS, RUNNER_TEMP or GITHUB_WORKSPACE");
  if (ENV_FILE_PATH.test(line) && CONTENT_TOOLS.test(line) && !/grep -F -c -f <\(/.test(line))
    out.push("env-file contents only feed grep -F -c -f <(…), never argv or the screen");
  return out;
}

export function partProblems(text, name, milestone = "m5", { inLib = false } = {}) {
  const spec = MILESTONES[milestone];
  const out = [];
  const lines = codeLines(text);
  if (!lines.some((l) => /^\s*set -u\b/.test(l.text))) out.push(`${name}: no set -u`);
  if (!lines.some((l) => /^\s*\.\s+"?\$\(dirname "\$0"\)\/lib\.sh"?\s*$/.test(l.text))) out.push(`${name}: does not source lib.sh`);
  const inRange = (p) => spec.ports.some(([lo, hi]) => p >= lo && p <= hi);
  const ranges = spec.ports.map(([lo, hi]) => (lo === hi ? `${lo}` : `${lo}-${hi}`)).join(", ");
  for (const l of lines) {
    const at = `${name}:${l.n}`;
    for (const p of portsOf(l.text)) if (!inRange(p)) out.push(`${at}: port ${p} is outside ${ranges}`);
    for (const p of [
      composeProblem(l.text, { configExempt: spec.strict }),
      removalProblem(l.text),
      libraryProblem(l.text),
      liveProblem(l.text),
    ])
      if (p) out.push(`${at}: ${p}`);
    if (spec.strict) for (const p of strictProblems(l.text, { inLib })) out.push(`${at}: ${p}`);
  }
  return out;
}

export function functionsOf(text) {
  const out = [];
  let cur;
  for (const l of codeLines(text)) {
    const start = /^([A-Za-z_][\w-]*)\(\)\s*\{(.*)$/.exec(l.text);
    if (start && !cur) {
      cur = { name: start[1], lines: [{ n: l.n, text: start[2] }] };
      if (/\}\s*$/.test(start[2])) {
        out.push(cur);
        cur = undefined;
      }
      continue;
    }
    if (!cur) continue;
    if (/^\}\s*$/.test(l.text)) {
      out.push(cur);
      cur = undefined;
    } else cur.lines.push(l);
  }
  return out;
}

function strictLibProblems(text) {
  const out = [];
  const fns = functionsOf(text);
  for (const f of fns) {
    const downAt = f.lines.findIndex((l) => DOWN_VOLUMES.test(l.text));
    if (downAt >= 0) {
      if (!/^down_/.test(f.name)) out.push(`lib.sh:${f.lines[downAt].n}: down -v outside a down_* helper (${f.name})`);
      if (!f.lines.slice(0, downAt).some((l) => /^\s*preflight\b.*\|\|\s*return 1\s*$/.test(l.text)))
        out.push(`lib.sh:${f.lines[downAt].n}: ${f.name} runs down -v without a preflight … || return 1 first`);
    }
    const inspects = f.lines.filter((l) => /\bdocker\s+(?:(?:image|container)\s+)?inspect\b/.test(l.text));
    if (inspects.length && !f.lines.some((l) => /^\s*require_oab_ref\b/.test(l.text)))
      out.push(`lib.sh:${inspects[0].n}: ${f.name} inspects without require_oab_ref`);
  }
  const inFn = new Set(fns.flatMap((f) => f.lines.map((l) => l.n)));
  for (const l of codeLines(text))
    if (!inFn.has(l.n) && (DOWN_VOLUMES.test(l.text) || /\bdocker\s+(?:(?:image|container)\s+)?inspect\b/.test(l.text)))
      out.push(`lib.sh:${l.n}: down -v and docker inspect belong inside a guarded helper`);
  return out;
}

export function libProblems(text, milestone = "m5") {
  const out = [];
  const code = codeLines(text).map((l) => l.text);
  if (!code.some((l) => /^\s*\.\s+"?\$REPO\/scripts\/preview-preflight\.sh"?/.test(l)))
    out.push("lib.sh must source scripts/preview-preflight.sh");
  if (!code.some((l) => /^\s*require_oab\b/.test(l))) out.push("lib.sh must refuse non-oab names (require_oab)");
  if (!code.some((l) => /exit-codes\.txt/.test(l))) out.push("lib.sh must record exit codes to $DEMO_DIR/exit-codes.txt");
  const prefix = 'set -u\n. "$(dirname "$0")/lib.sh"\n';
  for (const p of partProblems(prefix + text, "lib.sh", milestone, { inLib: true })) out.push(p);
  if (MILESTONES[milestone].strict) out.push(...strictLibProblems(text));
  return out;
}

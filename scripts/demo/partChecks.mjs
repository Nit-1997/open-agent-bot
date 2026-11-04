import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PARTS_DIR = join(resolve(dirname(fileURLToPath(import.meta.url))), "m5");
export const LIB = join(PARTS_DIR, "lib.sh");
export const PARTS = Object.freeze(Array.from({ length: 10 }, (_, n) => `part-${n}.sh`));
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

function composeProblem(line) {
  for (const m of line.matchAll(/docker compose\b(.*?)(?=$|&&|\|\||;|\|)/g)) {
    const args = m[1].trim();
    if (/^(ls|version)\b/.test(args)) continue;
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
    if (!/oab-|\$\(m5_images\)/.test(m[0])) return `removal must name an oab- resource: ${m[0].trim()}`;
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

export function partProblems(text, name) {
  const out = [];
  const lines = codeLines(text);
  if (!lines.some((l) => /^\s*set -u\b/.test(l.text))) out.push(`${name}: no set -u`);
  if (!lines.some((l) => /^\s*\.\s+"?\$\(dirname "\$0"\)\/lib\.sh"?\s*$/.test(l.text))) out.push(`${name}: does not source lib.sh`);
  for (const l of lines) {
    const at = `${name}:${l.n}`;
    for (const p of portsOf(l.text)) if (p < PORT_MIN || p > PORT_MAX) out.push(`${at}: port ${p} is outside ${PORT_MIN}-${PORT_MAX}`);
    for (const p of [composeProblem(l.text), removalProblem(l.text), libraryProblem(l.text), liveProblem(l.text)])
      if (p) out.push(`${at}: ${p}`);
  }
  return out;
}

export function libProblems(text) {
  const out = [];
  const code = codeLines(text).map((l) => l.text);
  if (!code.some((l) => /^\s*\.\s+"?\$REPO\/scripts\/preview-preflight\.sh"?/.test(l)))
    out.push("lib.sh must source scripts/preview-preflight.sh");
  if (!code.some((l) => /^\s*require_oab\b/.test(l))) out.push("lib.sh must refuse non-oab names (require_oab)");
  if (!code.some((l) => /exit-codes\.txt/.test(l))) out.push("lib.sh must record exit codes to $DEMO_DIR/exit-codes.txt");
  for (const p of partProblems(text.replace(/^/, 'set -u\n. "$(dirname "$0")/lib.sh"\n'), "lib.sh")) out.push(p);
  return out;
}

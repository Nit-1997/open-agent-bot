import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";

export type Rule = "B1" | "B2" | "B3" | "B4";
export type Violation = { rule: Rule; file: string; specifier: string };
export type SourceTree = Record<string, string>;

export const ENTRIES = ["server.ts", "scripts/rotateCredentials.ts"];
export const B1_EXCEPTIONS = [...ENTRIES, "app.ts"];
export const B3_EXCEPTIONS = ["auth/verify.ts"];

const SELF = "@oab/core";
const HOSTED = "hosted/";
const REGEX_AFTER = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await"]);

type Token = { kind: "word" | "string" | "punct"; value: string };

function tokenize(code: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const regexAllowed = () => {
    const prev = tokens.at(-1);
    if (!prev) return true;
    if (prev.kind === "string") return false;
    if (prev.kind === "word") return REGEX_AFTER.has(prev.value);
    return !")]}".includes(prev.value);
  };
  const skipQuoted = (quote: string) => {
    let value = "";
    i++;
    while (i < code.length && code[i] !== quote) {
      if (code[i] === "\\") i++;
      else value += code[i];
      i++;
    }
    i++;
    return value;
  };
  const skipTemplate = () => {
    i++;
    while (i < code.length && code[i] !== "`") {
      if (code[i] === "\\") i += 2;
      else if (code[i] === "$" && code[i + 1] === "{") {
        i += 2;
        scan("}");
        i++;
      } else i++;
    }
    i++;
  };
  const skipRegex = () => {
    let inClass = false;
    i++;
    while (i < code.length && (inClass || code[i] !== "/") && code[i] !== "\n") {
      if (code[i] === "\\") i++;
      else if (code[i] === "[") inClass = true;
      else if (code[i] === "]") inClass = false;
      i++;
    }
    i++;
    while (/[a-z]/i.test(code[i] ?? "")) i++;
  };
  function scan(until?: string) {
    let depth = 0;
    while (i < code.length) {
      const c = code[i]!;
      if (until && c === until && depth === 0) return;
      if (/\s/.test(c)) i++;
      else if (c === "/" && code[i + 1] === "/") i = code.indexOf("\n", i) === -1 ? code.length : code.indexOf("\n", i);
      else if (c === "/" && code[i + 1] === "*") i = code.indexOf("*/", i + 2) === -1 ? code.length : code.indexOf("*/", i + 2) + 2;
      else if (c === '"' || c === "'") tokens.push({ kind: "string", value: skipQuoted(c) });
      else if (c === "`") {
        skipTemplate();
        tokens.push({ kind: "punct", value: "`" });
      } else if (c === "/" && regexAllowed()) {
        skipRegex();
        tokens.push({ kind: "punct", value: "/re/" });
      } else if (/[A-Za-z_$]/.test(c)) {
        const word = /^[\w$]+/.exec(code.slice(i))![0];
        tokens.push({ kind: "word", value: word });
        i += word.length;
      } else {
        if (c === "{") depth++;
        if (c === "}") depth--;
        tokens.push({ kind: "punct", value: c });
        i++;
      }
    }
  }
  scan();
  return tokens;
}

export function importSpecifiers(code: string): string[] {
  const tokens = tokenize(code);
  const found: string[] = [];
  tokens.forEach((t, n) => {
    const next = tokens[n + 1];
    const prev = tokens[n - 1];
    if (t.kind !== "word" || prev?.value === ".") return;
    if (t.value === "import" && next?.kind === "string") found.push(next.value);
    else if (t.value === "import" && next?.value === "(" && tokens[n + 2]?.kind === "string") found.push(tokens[n + 2]!.value);
    else if (t.value === "from" && next?.kind === "string") found.push(next.value);
  });
  return found;
}

const isHosted = (file: string) => file.startsWith(HOSTED);

function target(file: string, specifier: string): string | undefined {
  if (specifier.startsWith(".")) return posix.normalize(posix.join(posix.dirname(file), specifier));
  if (specifier === SELF || specifier.startsWith(`${SELF}/`)) return specifier.slice(SELF.length + 1);
  return undefined;
}

const isVendor = (specifier: string) => specifier === "jose" || specifier.startsWith("jose/") || specifier.startsWith("@supabase/");

export type Exceptions = { b1: string[]; b3: string[] };

export function boundaryViolations(tree: SourceTree, exceptions: Exceptions = { b1: B1_EXCEPTIONS, b3: B3_EXCEPTIONS }): Violation[] {
  const out: Violation[] = [];
  for (const [file, code] of Object.entries(tree)) {
    for (const specifier of importSpecifiers(code)) {
      const add = (rule: Rule) => out.push({ rule, file, specifier });
      const to = target(file, specifier);
      const self = specifier === SELF || specifier.startsWith(`${SELF}/`);
      if (!isHosted(file) && to !== undefined && isHosted(to) && !exceptions.b1.includes(file)) add("B1");
      if (isHosted(file) && specifier.startsWith(".") && !isHosted(to!)) add("B2");
      if (!isHosted(file) && isVendor(specifier) && !exceptions.b3.includes(file)) add("B3");
      if (self && (isHosted(`${to}/`) || !isHosted(file))) add("B4");
    }
  }
  return out;
}

export function readSourceTree(dir: string): SourceTree {
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((f) => {
      const p = join(d, f);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
    });
  return Object.fromEntries(walk(dir).map((p) => [relative(dir, p).split(sep).join("/"), readFileSync(p, "utf8")]));
}

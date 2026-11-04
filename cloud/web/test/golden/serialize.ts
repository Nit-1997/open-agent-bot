import { VOLATILE_ATTRIBUTES } from "./volatile";

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const SKIP = new Set(VOLATILE_ATTRIBUTES.map((a) => a.name));

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "&#10;");
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, "&quot;");

function attributes(el: Element): string {
  return [...el.attributes]
    .filter((a) => !SKIP.has(a.name))
    .map((a) => [a.name, a.value] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => ` ${name}="${escapeAttr(value)}"`)
    .join("");
}

function lines(node: Node, depth: number, out: string[]): void {
  const pad = "  ".repeat(depth);
  if (node.nodeType === Node.TEXT_NODE) {
    out.push(`${pad}#text "${escapeText(node.textContent ?? "")}"`);
    return;
  }
  if (node.nodeType === Node.COMMENT_NODE) {
    out.push(`${pad}<!--${escapeText(node.textContent ?? "")}-->`);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  out.push(`${pad}<${tag}${attributes(el)}>`);
  if (VOID.has(tag)) return;
  for (const child of el.childNodes) lines(child, depth + 1, out);
  out.push(`${pad}</${tag}>`);
}

export function goldenHtml(root: Element): string {
  const out: string[] = [];
  for (const child of root.childNodes) lines(child, 0, out);
  return `${out.join("\n")}\n`;
}

import { hostOf } from "./sources";

export type StepArgs = Record<string, unknown>;

export const RENDER_TOOLS = new Set(["show_ui", "show_widget", "ask_user"]);

export function stepLabel(name: string, args: StepArgs, done = true): string {
  const host = (u: unknown) => hostOf(String(u ?? "")) ?? "a page";
  switch (name) {
    case "web_search":
      return `${done ? "Searched" : "Searching"} “${String(args.query ?? "")}”`;
    case "fetch_page":
      return `${done ? "Read" : "Reading"} ${host(args.url)}`;
    case "browse": {
      const actions = Array.isArray(args.actions) ? (args.actions as Array<{ op?: string; url?: string }>) : [];
      const goto = actions.find((a) => a.op === "goto");
      return `${done ? "Browsed" : "Browsing"} ${goto ? host(goto.url) : "a page"}`;
    }
    case "weather":
      return `${done ? "Checked" : "Checking"} weather in ${String(args.location ?? "…")}`;
    case "flights":
      return `${done ? "Searched" : "Searching"} flights ${String(args.from ?? "?")} → ${String(args.to ?? "?")}`;
    case "create_artifact":
      return `${done ? "Wrote" : "Writing"} “${String(args.title ?? "page")}”`;
    default:
      return name;
  }
}

export function stepKind(name: string): "search" | "read" | "weather" | "flight" | "write" | "other" {
  if (name === "web_search") return "search";
  if (name === "fetch_page" || name === "browse") return "read";
  if (name === "weather") return "weather";
  if (name === "flights") return "flight";
  if (name === "create_artifact") return "write";
  return "other";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function summarizeSteps(steps: Array<{ name: string }>): string {
  const count = (k: ReturnType<typeof stepKind>) => steps.filter((s) => stepKind(s.name) === k).length;
  return [
    count("search") && plural(count("search"), "search", "searches"),
    count("read") && plural(count("read"), "page read", "pages read"),
    count("flight") && plural(count("flight"), "flight search", "flight searches"),
    count("weather") && "weather",
    count("write") && plural(count("write"), "page written", "pages written"),
  ]
    .filter(Boolean)
    .join(" · ");
}

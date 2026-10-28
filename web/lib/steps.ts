import { hostOf } from "./sources";

export type StepArgs = Record<string, unknown>;

function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {}
    return v ? [v] : [];
  }
  return [];
}

export const RENDER_TOOLS = new Set(["show_ui", "show_widget", "ask_user", "suggest_replies"]);

export function stepLabel(name: string, args: StepArgs, done = true): string {
  const host = (u: unknown) => hostOf(String(u ?? "")) ?? "a page";
  switch (name) {
    case "web_search":
      return `${done ? "Searched" : "Searching"} “${String(args.query ?? "")}”`;
    case "image_search": {
      const many = list(args.queries);
      return `${done ? "Found" : "Finding"} pictures of ${many.length > 1 ? `${many.length} things` : `“${String(many[0] ?? args.query ?? "")}”`}`;
    }
    case "music": {
      const n = list(args.queries).length;
      const what = args.kind === "song" ? "song" : "album";
      return `${done ? "Looked up" : "Looking up"} ${n} ${n === 1 ? what : `${what}s`}`;
    }
    case "wikipedia": {
      const many = list(args.queries);
      return `${done ? "Read" : "Reading"} Wikipedia on ${many.length === 1 ? many[0] : `${many.length} topics`}`;
    }
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
  if (name === "web_search" || name === "image_search") return "search";
  if (name === "music" || name === "wikipedia") return "read";
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

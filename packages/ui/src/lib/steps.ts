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

export type WorkflowStepEvent = {
  workflow: "research";
  phase: "research" | "plan" | "implement" | "verify";
  status: "start" | "done";
  detail?: { sources?: number; supported?: number; total?: number; unchecked?: number };
};

const PHASE_LABELS = {
  research: "Researching sources",
  plan: "Planning the report",
  implement: "Writing the report",
  verify: "Checking claims",
};

function workflowLabel(args: StepArgs): string {
  const phase = String(args.phase) as WorkflowStepEvent["phase"];
  const label = PHASE_LABELS[phase] ?? "Working";
  const { supported, total } = args as { supported?: number; total?: number };
  return phase === "verify" && typeof supported === "number" && typeof total === "number"
    ? `${label} (${supported} of ${total} supported)`
    : label;
}

const verb = (done: boolean, past: string, present: string) => (done ? past : present);
const host = (u: unknown) => hostOf(String(u ?? "")) ?? "a page";
const capitalize = (st: string) => st.charAt(0).toUpperCase() + st.slice(1);

type Label = (args: StepArgs, done: boolean) => string;

function picturesOf(args: StepArgs): string {
  const many = list(args.queries);
  return many.length > 1 ? `${many.length} things` : `“${String(many[0] ?? args.query ?? "")}”`;
}

function browsedHost(args: StepArgs): string {
  const actions = Array.isArray(args.actions) ? (args.actions as Array<{ op?: string; url?: string }>) : [];
  const goto = actions.find((a) => a.op === "goto");
  return goto ? host(goto.url) : "a page";
}

function musicLabel(args: StepArgs, done: boolean): string {
  const n = list(args.queries).length;
  const what = args.kind === "song" ? "song" : "album";
  return `${verb(done, "Looked up", "Looking up")} ${n} ${n === 1 ? what : `${what}s`}`;
}

function shopLabel(args: StepArgs, done: boolean): string {
  const n = list(args.items).length;
  return `${verb(done, "Shopped", "Shopping")} ${n} ${n === 1 ? "item" : "items"} at ${list(args.stores).map(capitalize).join(", ")}`;
}

function wikipediaLabel(args: StepArgs, done: boolean): string {
  const many = list(args.queries);
  return `${verb(done, "Read", "Reading")} Wikipedia on ${many.length === 1 ? many[0] : `${many.length} topics`}`;
}

function planLabel(args: StepArgs, done: boolean): string {
  const action = args.action === "get" ? verb(done, "Read", "Reading") : verb(done, "Updated", "Updating");
  return `${action} the ${String(args.kind ?? "plan")}`;
}

const LABELS: Record<string, Label> = {
  web_search: (a, d) => `${verb(d, "Searched", "Searching")} “${String(a.query ?? "")}”`,
  image_search: (a, d) => `${verb(d, "Found", "Finding")} pictures of ${picturesOf(a)}`,
  music: musicLabel,
  shop: shopLabel,
  wikipedia: wikipediaLabel,
  fetch_page: (a, d) => `${verb(d, "Read", "Reading")} ${host(a.url)}`,
  browse: (a, d) => `${verb(d, "Browsed", "Browsing")} ${browsedHost(a)}`,
  stays: (a, d) => `${verb(d, "Searched", "Searching")} stays in ${String(a.location ?? "…")}`,
  weather: (a, d) => `${verb(d, "Checked", "Checking")} weather in ${String(a.location ?? "…")}`,
  flights: (a, d) => `${verb(d, "Searched", "Searching")} flights ${String(a.from ?? "?")} → ${String(a.to ?? "?")}`,
  plan: planLabel,
  create_artifact: (a, d) => `${verb(d, "Wrote", "Writing")} “${String(a.title ?? "page")}”`,
  research: (a, d) => `${verb(d, "Researched", "Researching")} “${String(a.question ?? "the question")}”`,
  workflow_step: (a) => workflowLabel(a),
};

export function stepLabel(name: string, args: StepArgs, done = true): string {
  return Object.hasOwn(LABELS, name) ? LABELS[name](args, done) : name;
}

export function stepKind(name: string): "search" | "read" | "weather" | "flight" | "write" | "other" {
  if (name === "web_search" || name === "image_search" || name === "stays") return "search";
  if (name === "music" || name === "wikipedia" || name === "shop") return "read";
  if (name === "fetch_page" || name === "browse") return "read";
  if (name === "weather") return "weather";
  if (name === "flights") return "flight";
  if (name === "create_artifact" || name === "research") return "write";
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

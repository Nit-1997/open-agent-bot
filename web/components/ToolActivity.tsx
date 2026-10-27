type Params = Record<string, unknown> | undefined;

function host(url: unknown): string | undefined {
  try {
    return new URL(String(url)).hostname;
  } catch {
    return undefined;
  }
}

export function toolLabel(name: string, p: Params): string {
  const params = p ?? {};
  switch (name) {
    case "web_search":
      return `Searching "${params.query ?? ""}"`;
    case "fetch_page":
      return host(params.url) ? `Opening ${host(params.url)}` : "Opening page";
    case "browse": {
      const actions = Array.isArray(params.actions) ? (params.actions as Array<{ op?: string; url?: string }>) : [];
      const goto = actions.find((a) => a.op === "goto");
      return goto && host(goto.url) ? `Opening ${host(goto.url)}` : "Browsing";
    }
    case "weather":
      return `Checking weather for ${params.location ?? "…"}`;
    case "flights":
      return `Searching flights ${params.from ?? "?"} → ${params.to ?? "?"}`;
    case "create_artifact":
      return "Writing page";
    default:
      return name;
  }
}

export function ToolActivity(props: {
  toolCallId: string;
  name: string;
  status: "inProgress" | "executing" | "complete";
  parameters: unknown;
}) {
  const busy = props.status !== "complete";
  const id = `tool-activity-${props.toolCallId}`;
  return (
    <div
      id={id}
      role="status"
      aria-busy={busy}
      className="my-1 flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400"
    >
      <span
        id={`${id}-icon`}
        aria-hidden="true"
        className={busy ? "inline-block h-3 w-3 animate-spin rounded-full border-2 border-neutral-400 border-t-transparent" : "inline-block w-3 text-center"}
      >
        {busy ? "" : "✓"}
      </span>
      <span id={`${id}-label`}>{toolLabel(props.name, props.parameters as Params)}</span>
    </div>
  );
}

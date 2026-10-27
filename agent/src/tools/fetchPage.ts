import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fail, ok, type ToolResult } from "./result.js";
import { publicHttpUrlError } from "./net.js";
import { htmlToText, truncate } from "./text.js";

const BLOCKING_STATUSES = new Set([401, 403, 429, 503]);

export function httpErrorText(status: number, host: string): string {
  return BLOCKING_STATUSES.has(status)
    ? `HTTP ${status} from ${host} — the site may be blocking automated access`
    : `HTTP ${status} from ${host}`;
}

export function fetchPageTool(deps: { fetch?: typeof fetch } = {}) {
  const f = deps.fetch ?? fetch;
  return defineTool({
    name: "fetch_page",
    label: "Fetch page",
    description:
      "Fetch a URL and return its readable text. Fast; use for articles and simple pages. For pages that need JavaScript or interaction (stores, flight search), use browse.",
    parameters: Type.Object({ url: Type.String({ minLength: 1 }) }),
    async execute(_id, params, signal): Promise<ToolResult> {
      const urlError = publicHttpUrlError(params.url);
      if (urlError) return fail(urlError);
      const url = new URL(params.url);
      try {
        const res = await f(url, {
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
          headers: { "user-agent": "Mozilla/5.0 (compatible; OpenAgent/0.1)", accept: "text/html,text/plain,application/json" },
          redirect: "follow",
        });
        if (!res.ok) return fail(httpErrorText(res.status, url.host));
        const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (type === "text/html" || type === "application/xhtml+xml") {
          return ok(`url: ${res.url || url.href}\n\n${truncate(htmlToText(await res.text()))}`);
        }
        if (type === "text/plain" || type === "application/json" || type.endsWith("+json")) {
          return ok(`url: ${res.url || url.href}\n\n${truncate(await res.text())}`);
        }
        return fail(`unsupported content-type ${type || "unknown"}`);
      } catch (err) {
        return fail(`fetch failed for ${url.host}: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  });
}

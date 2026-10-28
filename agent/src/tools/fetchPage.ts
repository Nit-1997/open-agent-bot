import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fail, ok, type ToolResult } from "./result.js";
import { BLOCKING_STATUSES, fetchPublic, type Lookup, publicHttpUrlError, readCapped, timeoutSignal } from "./net.js";
import { htmlToText, imagesText, truncate } from "./text.js";

const MAX_BODY_BYTES = 5_000_000;

export function httpErrorText(status: number, host: string): string {
  return BLOCKING_STATUSES.has(status)
    ? `HTTP ${status} from ${host} — the site may be blocking automated access`
    : `HTTP ${status} from ${host}`;
}

export function fetchPageTool(deps: { fetch?: typeof fetch; lookup?: Lookup } = {}) {
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
        const { res, url: at } = await fetchPublic(f, url.href, {
          signal: timeoutSignal(15000, signal),
          headers: { "user-agent": "Mozilla/5.0 (compatible; OpenAgent/0.1)", accept: "text/html,text/plain,application/json" },
        }, { lookup: deps.lookup });
        if (!res.ok) return fail(httpErrorText(res.status, new URL(at).host));
        const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (type === "text/html" || type === "application/xhtml+xml") {
          const page = await readCapped(res, MAX_BODY_BYTES);
          const body = truncate(htmlToText(page));
          return ok(`url: ${at}\n\n${body}${imagesText(page, at, body)}`);
        }
        if (type === "text/plain" || type === "application/json" || type.endsWith("+json")) {
          return ok(`url: ${at}\n\n${truncate(await readCapped(res, MAX_BODY_BYTES))}`);
        }
        return fail(`unsupported content-type ${type || "unknown"}`);
      } catch (err) {
        return fail(`fetch failed for ${url.host}: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  });
}

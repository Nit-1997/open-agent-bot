import type { BrowserContext } from "playwright";
import { dnsLookup, type Lookup, publicHttpUrlError, resolvesInternal } from "../lib/net.js";

const CACHE_MS = 60_000;

export async function blockInternalRequests(
  context: BrowserContext,
  opts: { allowPrivateHosts?: boolean; lookup?: Lookup } = {},
): Promise<void> {
  if (opts.allowPrivateHosts) return;
  const resolve = opts.lookup ?? dnsLookup;
  const cache = new Map<string, { at: number; internal: Promise<boolean> }>();
  const internal = (host: string) => {
    const hit = cache.get(host);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.internal;
    const entry = { at: Date.now(), internal: resolvesInternal(host, resolve) };
    cache.set(host, entry);
    return entry.internal;
  };
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (!/^https?:/i.test(url)) return route.continue();
    if (publicHttpUrlError(url) || (await internal(new URL(url).hostname))) return route.abort("blockedbyclient");
    return route.continue();
  });
}

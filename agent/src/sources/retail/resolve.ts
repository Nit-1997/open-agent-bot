import type { SourceRegistry } from "../registry.js";
import { jsonldStore } from "./jsonldStore.js";
import type { RetailSource, Store } from "./types.js";

export function normalizeStore(input: string): string {
  return input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

export function resolveStore(registry: SourceRegistry, input: string, opts: { jsonld?: boolean } = {}): Store {
  const raw = normalizeStore(input);
  const stores = registry.select<RetailSource>({ vertical: "retail" });
  const compact = raw.replace(/\s+/g, "");
  const known = stores.find((s) => s.id === raw || s.domains.includes(raw)) ?? (raw.includes(".") ? undefined : stores.find((s) => s.id === compact || s.aliases?.includes(raw)));
  if (known) return known;
  const domain = raw.includes(".") ? raw : `${compact}.com`;
  if (opts.jsonld) return jsonldStore(domain);
  return { id: domain, label: domain, home: `https://www.${domain}/` };
}

import { registry } from "../sources/index.js";
import { resolveStore } from "../sources/retail/resolve.js";
import type { Store } from "../sources/retail/types.js";

export type { Store };

export function storeFor(input: string): Store {
  return resolveStore(registry, input);
}

type StoreKind = "grocery" | "general";

export function defaultStoresFor(country: string, kind: StoreKind): string[] {
  return registry.defaults({ vertical: "retail", region: country, kind }).map((s) => s.id);
}

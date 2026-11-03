import { googleFlights } from "./flights/google.js";
import { SourceRegistry } from "./registry.js";
import { SIMPLE_STORES } from "./retail/stores.js";
import { shipt } from "./retail/shipt.js";
import { STAY_SOURCES } from "./stays/index.js";

export function createRegistry(): SourceRegistry {
  const registry = new SourceRegistry();
  registry.register(shipt);
  for (const s of SIMPLE_STORES) registry.register(s);
  for (const s of STAY_SOURCES) registry.register(s);
  registry.register(googleFlights);
  return registry;
}

export const registry = createRegistry();

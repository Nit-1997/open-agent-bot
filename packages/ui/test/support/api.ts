import { vi } from "vitest";

export async function freshApiModule() {
  vi.resetModules();
  return import("../../src/platform/api.ts");
}

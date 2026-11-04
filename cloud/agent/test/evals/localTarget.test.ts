import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadsSupabase } from "../../../../packages/core/test/evals/moduleGraph.js";

describe("evals module graph", () => {
  it("the probe sees Supabase load for --target hosted (control)", () => {
    const { supabase, out } = loadsSupabase("hosted", join(import.meta.dirname, "../../evals/run.ts"));
    expect(out).toMatch(/transport error: evals need SUPABASE_URL/);
    expect(supabase).toBe(true);
  });
});

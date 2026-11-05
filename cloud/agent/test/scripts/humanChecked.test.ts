import { afterEach, describe, expect, it, vi } from "vitest";
import { humanCheckTestUsers, markHumanChecked } from "../../../supabase/scripts/test-users.mjs";

afterEach(() => vi.restoreAllMocks());

const ENV = { url: "http://127.0.0.1:18741", key: "sb_secret_test" };

describe("test-users.mjs --human-checked", () => {
  it("upserts human_checks rows with the service key, ignoring existing ones", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 201 }));
    expect(await markHumanChecked(ENV, ["u1", "u2"])).toBe(2);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:18741/rest/v1/human_checks?on_conflict=user_id");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ apikey: "sb_secret_test", prefer: "resolution=ignore-duplicates,return=minimal" });
    expect(JSON.parse(String(init?.body))).toEqual([{ user_id: "u1" }, { user_id: "u2" }]);
  });

  it("marks only oab-e2e+ and oab-test+ users, and nothing when there are none", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 201 }));
    const uuid = "0f1e2d3c-4b5a-4968-8776-655443322110";
    const admin = {
      pageSize: 1000,
      listUsers: async () => [
        { id: "e2e", email: "oab-e2e+shell@example.test" },
        { id: "int", email: `oab-test+${uuid}@example.test` },
        { id: "real", email: "priya@example.com" },
      ],
    };
    expect(await humanCheckTestUsers(admin, ENV)).toBe(2);
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual([{ user_id: "e2e" }, { user_id: "int" }]);
    fetch.mockClear();
    expect(await markHumanChecked(ENV, [])).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails loudly on an HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
    await expect(markHumanChecked(ENV, ["u1"])).rejects.toThrow("human_checks upsert failed: HTTP 404");
  });
});

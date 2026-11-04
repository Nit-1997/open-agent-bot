import { describe, expect } from "vitest";
import { createSupabaseStore } from "../../src/store/supabaseStore.js";
import { describeStoreContract } from "../../../../packages/core/test/contract/store.js";
import { authAdmin, createBareUser, deleteCreatedUsers, enabled, remainingRows, service } from "./helpers.js";

describe.skipIf(!enabled)("live Supabase", () => {
  describeStoreContract("Supabase", async () => {
    const db = service();
    const users: Array<{ id: string; email: string }> = [];
    return {
      store: createSupabaseStore(db),
      async newUser() {
        const user = await createBareUser();
        users.push(user);
        return user.id;
      },
      async dispose() {
        const report = await deleteCreatedUsers();
        const remaining = await remainingRows(users.map((u) => u.email));
        const left = (await Promise.all(users.map((u) => authAdmin().getUser(u.id)))).filter(Boolean).length;
        try {
          expect(report.failed).toEqual([]);
          expect(remaining).toBe(0);
          expect(left).toBe(0);
        } finally {
          console.info(
            `[store contract cleanup] created=${users.length} deleted=${report.deleted.length} failed=${report.failed.length} remainingRows=${remaining} authUsersLeft=${left}`,
          );
        }
      },
    };
  });
});

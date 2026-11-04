import { randomUUID } from "node:crypto";
import { openSqliteStore } from "../../src/local/store/sqliteStore.js";
import { describeStoreContract } from "../contract/store.js";
import { tempDir } from "./storeHarness.js";

describeStoreContract("SQLite", async () => {
  const tmp = tempDir("oab-contract-");
  const store = openSqliteStore({ dir: tmp.dir });
  return {
    store,
    newUser: async () => {
      const id = randomUUID();
      store.ensureUser(id, `${id}@contract.invalid`);
      return id;
    },
    dispose: async () => {
      await store.close();
      tmp.dispose();
    },
  };
});

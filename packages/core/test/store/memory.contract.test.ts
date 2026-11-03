import { randomUUID } from "node:crypto";
import { describeStoreContract } from "../contract/store.js";
import { MemoryDb } from "../fixtures/memoryRepos.js";

describeStoreContract("MemoryDb", async () => ({
  store: new MemoryDb(),
  newUser: async () => randomUUID(),
  dispose: async () => {},
}));

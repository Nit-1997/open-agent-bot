import { createSafeFetch } from "../../src/lib/safeFetch.js";
import { ProviderHub } from "../../src/providers/hub.js";
import { EnvelopeCredentialStore } from "../../src/providers/credentialStore.js";
import { wrapper } from "./app.js";
import { fakeFetch } from "./fakeFetch.js";
import { MemoryDb } from "./memoryRepos.js";
import { ADMIN, ALL_CAPABILITIES } from "./users.js";

type Extra = Partial<Omit<Parameters<typeof ProviderHub.create>[0], "settings" | "credentials">>;

export async function testHub(extra: Extra = {}, db = new MemoryDb()) {
  const userId = extra.userId ?? ADMIN.id;
  const repos = db.forUser(userId);
  const hub = await ProviderHub.create({
    userId,
    capabilities: ALL_CAPABILITIES,
    settings: repos.providerSettings,
    credentials: new EnvelopeCredentialStore(userId, repos.credentials, wrapper),
    fetch: fakeFetch([]),
    lookup: async () => ["93.184.216.34"],
    userFetch: createSafeFetch(extra.fetch ?? fakeFetch([])),
    ...extra,
  });
  return hub;
}

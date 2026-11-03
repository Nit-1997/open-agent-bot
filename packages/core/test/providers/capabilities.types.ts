import { ProviderHub } from "../../src/providers/hub.js";

declare const base: Omit<Parameters<typeof ProviderHub.create>[0], "capabilities">;

// @ts-expect-error capabilities is required, with no default
void ProviderHub.create(base);

// @ts-expect-error every hub capability must be given
void ProviderHub.create({ ...base, capabilities: { privateNetworkModels: true } });

// @ts-expect-error the admin flag is gone
void ProviderHub.create({ ...base, isAdmin: true });

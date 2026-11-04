import type { Principal } from "../identity/types.js";
import type { UserRepos } from "../store/types.js";
import { type HubCredentials, type HubOptions, ProviderHub } from "./hub.js";

export type GatewayLike = Readonly<{ baseUrl: string; apiKey: string; models: Array<{ id: string; label: string; note?: string }> }>;

export type HubFactoryDeps = Readonly<{
  repos: (userId: string) => Pick<UserRepos, "providerSettings">;
  credentials: (userId: string) => HubCredentials;
  gateway?: GatewayLike;
  network?: Pick<HubOptions, "fetch" | "userFetch" | "lookup">;
}>;

export function hubFactory(deps: HubFactoryDeps): (user: Principal) => Promise<ProviderHub> {
  return (user) => {
    const r = deps.repos(user.id);
    const gateway = user.capabilities.operatorGateway ? deps.gateway : undefined;
    return ProviderHub.create({
      userId: user.id,
      capabilities: user.capabilities,
      settings: r.providerSettings,
      credentials: deps.credentials(user.id),
      ...(gateway && { litellm: { baseUrl: gateway.baseUrl, apiKey: gateway.apiKey, models: gateway.models } }),
      ...deps.network,
    });
  };
}

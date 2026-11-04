import type { Capabilities } from "@oab/core/identity/types.js";

export const hostedCapabilities = (claimsAdmin: boolean): Capabilities =>
  Object.freeze({ admin: claimsAdmin, privateNetworkModels: claimsAdmin, operatorGateway: claimsAdmin });

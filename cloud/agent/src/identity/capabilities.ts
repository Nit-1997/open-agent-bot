import type { Capabilities } from "@oab/core/identity/types.js";

export const hostedCapabilities = (effectiveAdmin: boolean): Capabilities =>
  Object.freeze({ admin: effectiveAdmin, privateNetworkModels: effectiveAdmin, operatorGateway: effectiveAdmin });

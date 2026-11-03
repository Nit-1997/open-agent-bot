import type { HubCredentials } from "../providers/hub.js";
import type { Store } from "../store/types.js";
import { EnvelopeCredentialStore } from "./credentialStore.js";
import type { KeyWrapper } from "./keyWrapper.js";

export const secretsFor =
  (store: Store, wrapper: KeyWrapper) =>
  (userId: string): HubCredentials =>
    new EnvelopeCredentialStore(userId, store.forUser(userId).credentials, wrapper);

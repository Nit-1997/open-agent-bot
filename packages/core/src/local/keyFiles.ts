import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { log } from "../lib/log.js";
import { checkDir, loadOrCreateSecretFile, lstatOrMissing, newHexSecret, parseHexSecret } from "../lib/secretFile.js";
import type { CredentialKeys } from "../secrets/keyWrapper.js";
import { parseCredentialKeys } from "../secrets/keys.js";
import { StartupRefusal } from "./refusal.js";

export type LocalKeysOptions = {
  keysDir: string;
  rendererDir: string;
  credentialRows: () => number;
  reset: boolean;
  resetCredentials: () => number;
};

const KEK_LABEL = "credential key";
const RENDERER_LABEL = "renderer secret";

export const newAgentSecret = newHexSecret;
export const newKekFile = (): string => `v1:${randomBytes(32).toString("base64")}`;

export function parseKekFile(raw: string): CredentialKeys | undefined {
  const entry = /^(v[1-9]\d{0,5}:[A-Za-z0-9+/]+={0,2})\n?$/.exec(raw)?.[1];
  if (!entry) return undefined;
  try {
    return parseCredentialKeys(entry);
  } catch {
    return undefined;
  }
}

const savedKeys = (n: number) => `${n} saved model key${n === 1 ? "" : "s"}`;

export function loadLocalKeys(o: LocalKeysOptions): { kek: CredentialKeys; rendererSecret: string } {
  const kekPath = join(o.keysDir, "kek");
  checkDir(o.keysDir, KEK_LABEL, false);
  if (!lstatOrMissing(kekPath, `the ${KEK_LABEL} file ${kekPath}`)) {
    const rows = o.credentialRows();
    if (rows > 0 && !o.reset) {
      throw new StartupRefusal(
        "kek_missing",
        `the credential key ${kekPath} is missing but the database holds ${savedKeys(rows)} sealed with it. Restore the keys volume, or start once with OPEN_AGENT_RESET_CREDENTIALS=1 to delete them and re-enter them in Models`,
      );
    }
    if (rows > 0) {
      const deleted = o.resetCredentials();
      log.warn(
        `[startup] OPEN_AGENT_RESET_CREDENTIALS=1: the credential key was missing, so ${savedKeys(deleted)} ${deleted === 1 ? "was" : "were"} deleted and a new key was created; re-enter ${deleted === 1 ? "it" : "them"} in Models`,
      );
    }
  }
  const kek = loadOrCreateSecretFile({ path: kekPath, generate: newKekFile, parse: parseKekFile, label: KEK_LABEL });
  const rendererSecret = loadOrCreateSecretFile({
    path: join(o.rendererDir, "secret"),
    generate: newHexSecret,
    parse: parseHexSecret,
    label: RENDERER_LABEL,
  });
  return { kek, rendererSecret };
}

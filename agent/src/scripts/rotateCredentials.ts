import { loadConfig } from "../config.js";
import { CredentialIntegrityError, rewrap } from "../crypto/envelope.js";
import { LocalKeyWrapper } from "../crypto/keyWrapper.js";
import { createServiceClient } from "../db/client.js";
import { createRotationRepo, type StaleCredential } from "../db/rotation.js";

const cfg = loadConfig(process.env);
const wrapper = new LocalKeyWrapper(cfg.credentialKeys);
const repo = createRotationRepo(createServiceClient(cfg));
const current = wrapper.currentVersion;
const failed = new Set<string>();
let rewrapped = 0;

async function rotate(c: StaleCredential): Promise<void> {
  const key = `${c.userId}/${c.provider}`;
  const ctx = { userId: c.userId, provider: c.provider, kind: c.kind };
  try {
    if (await repo.replaceWrap(c, await rewrap(wrapper, c.sealed, ctx))) {
      rewrapped++;
      return;
    }
    const fresh = (await repo.stale(current)).find((s) => s.userId === c.userId && s.provider === c.provider);
    if (fresh && (await repo.replaceWrap(fresh, await rewrap(wrapper, fresh.sealed, ctx)))) {
      rewrapped++;
      return;
    }
    if (fresh) failed.add(key);
  } catch (err) {
    failed.add(key);
    console.error(
      `rewrap failed user=${c.userId} provider=${c.provider}: ${err instanceof CredentialIntegrityError ? "integrity check" : "error"}`,
    );
  }
}

for (;;) {
  const batch = (await repo.stale(current)).filter((c) => !failed.has(`${c.userId}/${c.provider}`));
  if (!batch.length) break;
  for (const c of batch) await rotate(c);
}
const left = await repo.countBelow(current);
console.log(`rewrapped ${rewrapped}; ${left} rows below current (v${current})${failed.size ? `; ${failed.size} failed` : ""}`);
process.exit(left === 0 ? 0 : 1);

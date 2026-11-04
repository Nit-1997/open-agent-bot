import { CredentialIntegrityError, rewrap } from "@oab/core/secrets/envelope.js";
import type { KeyWrapper } from "@oab/core/secrets/keyWrapper.js";
import type { RotationCursor, StaleCredential } from "../store/rotation.js";

export type RotationRepo = {
  stale(belowVersion: number, after?: RotationCursor): Promise<StaleCredential[]>;
  get(userId: string, provider: string): Promise<StaleCredential | undefined>;
  replaceWrap(c: StaleCredential, next: Awaited<ReturnType<typeof rewrap>>): Promise<boolean>;
  countBelow(version: number): Promise<number>;
};

export type RotationReport = { rewrapped: number; failed: number; left: number; current: number };

export async function rotateStale(
  repo: RotationRepo,
  wrapper: KeyWrapper & { currentVersion: number },
  report: (line: string) => void,
): Promise<RotationReport> {
  const current = wrapper.currentVersion;
  let rewrapped = 0;
  let failed = 0;

  const attempt = async (c: StaleCredential) => {
    const ctx = { userId: c.userId, provider: c.provider, kind: c.kind };
    return repo.replaceWrap(c, await rewrap(wrapper, c.sealed, ctx));
  };

  const rotate = async (c: StaleCredential): Promise<void> => {
    try {
      if (await attempt(c)) {
        rewrapped++;
        return;
      }
      const fresh = await repo.get(c.userId, c.provider);
      if (!fresh || fresh.sealed.keyVersion >= current) return;
      if (await attempt(fresh)) rewrapped++;
      else failed++;
    } catch (err) {
      failed++;
      report(
        `rewrap failed user=${c.userId} provider=${c.provider}: ${err instanceof CredentialIntegrityError ? "integrity check" : "error"}`,
      );
    }
  };

  let cursor: RotationCursor | undefined;
  for (;;) {
    const batch = await repo.stale(current, cursor);
    if (!batch.length) break;
    for (const c of batch) await rotate(c);
    const last = batch.at(-1)!;
    cursor = { userId: last.userId, provider: last.provider };
  }
  return { rewrapped, failed, left: await repo.countBelow(current), current };
}

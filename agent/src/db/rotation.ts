import type { CredentialKind, Sealed } from "../crypto/envelope.js";
import type { Db } from "./client.js";
import { toBytea } from "./bytea.js";
import { must, read } from "./errors.js";
import { credentialFromDb } from "./users.js";

export type StaleCredential = { userId: string; provider: string; kind: CredentialKind; version: number; sealed: Sealed };
export type RotationCursor = { userId: string; provider: string };

export const ROTATION_BATCH = 100;
const COLUMNS = "user_id, provider, kind, ciphertext, nonce, dek_wrapped, dek_nonce, key_version, hint, version";

const toStale = (r: Parameters<typeof credentialFromDb>[0] & { user_id: string }): StaleCredential => {
  const row = credentialFromDb(r);
  return { userId: r.user_id, provider: row.provider, kind: row.kind, version: row.version, sealed: row };
};

export function createRotationRepo(db: Db) {
  return {
    async stale(belowVersion: number, after?: RotationCursor): Promise<StaleCredential[]> {
      const { data } = await read("rotation.stale", () => {
        let q = db.from("provider_credentials").select(COLUMNS).lt("key_version", belowVersion);
        if (after) q = q.or(`user_id.gt.${after.userId},and(user_id.eq.${after.userId},provider.gt.${JSON.stringify(after.provider)})`);
        return q.order("user_id").order("provider").limit(ROTATION_BATCH);
      });
      return (data ?? []).map(toStale);
    },
    async get(userId: string, provider: string): Promise<StaleCredential | undefined> {
      const { data } = await read("rotation.get", () =>
        db.from("provider_credentials").select(COLUMNS).eq("user_id", userId).eq("provider", provider).maybeSingle(),
      );
      return data ? toStale(data) : undefined;
    },
    async replaceWrap(c: StaleCredential, next: Sealed): Promise<boolean> {
      const { data } = await must(
        "rotation.replace",
        db
          .from("provider_credentials")
          .update({
            dek_wrapped: toBytea(next.dekWrapped),
            dek_nonce: toBytea(next.dekNonce),
            key_version: next.keyVersion,
            version: c.version + 1,
          })
          .eq("user_id", c.userId)
          .eq("provider", c.provider)
          .eq("version", c.version)
          .select("version"),
      );
      return (data?.length ?? 0) > 0;
    },
    async countBelow(version: number): Promise<number> {
      const { count } = await read("rotation.count", () =>
        db.from("provider_credentials").select("provider", { count: "exact", head: true }).lt("key_version", version),
      );
      return count ?? 0;
    },
  };
}

import type { CredentialKind, Sealed } from "../crypto/envelope.js";
import type { Db } from "./client.js";
import { toBytea } from "./bytea.js";
import { must, read, timeout } from "./errors.js";
import { credentialFromDb } from "./users.js";

export type StaleCredential = { userId: string; provider: string; kind: CredentialKind; version: number; sealed: Sealed };

const BATCH = 100;

export function createRotationRepo(db: Db) {
  return {
    async stale(belowVersion: number): Promise<StaleCredential[]> {
      const { data } = await read("rotation.stale", () =>
        db
          .from("provider_credentials")
          .select("user_id, provider, kind, ciphertext, nonce, dek_wrapped, dek_nonce, key_version, hint, version")
          .lt("key_version", belowVersion)
          .order("user_id")
          .order("provider")
          .limit(BATCH)
          .abortSignal(timeout()),
      );
      return ((data ?? []) as Array<Parameters<typeof credentialFromDb>[0] & { user_id: string }>).map((r) => {
        const row = credentialFromDb(r);
        return { userId: r.user_id, provider: row.provider, kind: row.kind, version: row.version, sealed: row };
      });
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
          .select("version")
          .abortSignal(timeout()),
      );
      return (data?.length ?? 0) > 0;
    },
    async countBelow(version: number): Promise<number> {
      const { count } = await read("rotation.count", () =>
        db
          .from("provider_credentials")
          .select("provider", { count: "exact", head: true })
          .lt("key_version", version)
          .abortSignal(timeout()),
      );
      return count ?? 0;
    },
  };
}

import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { type CredentialContext, CredentialIntegrityError, type CredentialKind, open, seal } from "./envelope.js";
import { keyHint, oauthHint } from "./hint.js";
import type { KeyWrapper } from "./keyWrapper.js";
import type { CredentialListing, CredentialRepo, CredentialRow } from "../store/types.js";
import { UserError } from "../lib/errors.js";
import { log } from "../lib/log.js";
import { KeyedMutex } from "../lib/mutex.js";

const reported = new Set<string>();

function hintFor(c: Credential): string {
  if (c.type === "oauth") return oauthHint(c.email);
  return c.key ? keyHint(c.key) : "Key saved";
}

export class EnvelopeCredentialStore implements CredentialStore {
  private readonly mutex = new KeyedMutex();

  constructor(
    private readonly userId: string,
    private readonly repo: CredentialRepo,
    private readonly wrapper: KeyWrapper,
  ) {}

  private ctx(provider: string, kind: CredentialKind): CredentialContext {
    return { userId: this.userId, provider, kind };
  }

  private async decode(row: CredentialRow): Promise<Credential | undefined> {
    let plain: Buffer | undefined;
    try {
      plain = await open(this.wrapper, row, this.ctx(row.provider, row.kind));
      const parsed = JSON.parse(plain.toString("utf8")) as Credential;
      return parsed.type === row.kind ? parsed : undefined;
    } catch (err) {
      const key = `${this.userId}:${row.provider}`;
      if (!reported.has(key)) {
        reported.add(key);
        if (err instanceof CredentialIntegrityError) log.error(`[crypto] ${err.message}`);
        else log.error(`[crypto] credential unreadable user=${this.userId} provider=${row.provider}`);
      }
      return undefined;
    } finally {
      plain?.fill(0);
    }
  }

  async read(providerId: string): Promise<Credential | undefined> {
    const row = await this.repo.read(providerId);
    return row && this.decode(row);
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return (await this.repo.list()).map((r) => ({ providerId: r.provider, type: r.kind }));
  }

  listings(): Promise<CredentialListing[]> {
    return this.repo.list();
  }

  modify(providerId: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined> {
    return this.mutex.run(providerId, async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const row = await this.repo.read(providerId);
        const current = row && (await this.decode(row));
        const next = await fn(current);
        if (next === undefined) return current;
        const plain = Buffer.from(JSON.stringify(next), "utf8");
        let sealed: Awaited<ReturnType<typeof seal>>;
        try {
          sealed = await seal(this.wrapper, plain, this.ctx(providerId, next.type));
        } finally {
          plain.fill(0);
        }
        const record = { ...sealed, provider: providerId, kind: next.type, hint: hintFor(next) };
        if (!row) {
          try {
            await this.repo.insert(record);
            return next;
          } catch (err) {
            if (err instanceof UserError && err.kind === "conflict") continue;
            throw err;
          }
        }
        if (await this.repo.update(record, row.version)) return next;
      }
      throw new UserError("That sign-in changed at the same time. Try again.", "conflict");
    });
  }

  delete(providerId: string): Promise<void> {
    return this.mutex.run(providerId, () => this.repo.delete(providerId));
  }
}

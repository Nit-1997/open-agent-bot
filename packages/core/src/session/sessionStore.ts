import type { OpenReport } from "../artifacts/openReport.js";
import type { Principal } from "../identity/types.js";
import type { FrameBus } from "../browser/frames.js";
import type { Evidence } from "../grounding/evidence.js";
import { log } from "../lib/log.js";
import type { PiSession } from "../pi/createPiSession.js";
import type { AgentPersona } from "@oab/shared/profile";
import type { UserContext } from "../prompt/userContext.js";
import type { ActiveCart } from "../shop/cart.js";
import type { EarlierCards } from "../workspace/earlier.js";
import type { WorkspaceStore } from "../workspace/store.js";

export type HistoryMessage = { role: "user" | "assistant"; text: string };

export type SessionSeed = { history?: HistoryMessage[]; earlier?: EarlierCards };

export type SessionOwner = { user: Principal; chatId: string };

export type SessionEntry = {
  session: PiSession;
  busy: boolean;
  retired?: boolean;
  lastRunId?: string;
  lastUsed: number;
  dispose: () => Promise<void>;
  onRunStart?: () => void;
  evidence?: Evidence;
  setModel?: (id: string) => Promise<void>;
  frames?: FrameBus;
  cart?: ActiveCart;
  workspace: WorkspaceStore;
  setEditsNote?: (note: string | undefined) => void;
  turnStats?: () => { jevCalls: number; jevCostUsd: number };
  setOpenReport?: (note: string | undefined) => void;
  openReport?: OpenReport;
};

export type CreateSession = (
  owner: SessionOwner,
  ctx: UserContext | null,
  persona: AgentPersona,
  seed?: SessionSeed,
) => Promise<SessionEntry>;

export class SessionCapacityError extends Error {
  constructor() {
    super("The agent is at capacity. Try again shortly.");
    this.name = "SessionCapacityError";
  }
}

export const sessionKey = (owner: SessionOwner) => `${owner.user.id}:${owner.chatId}`;

type Limits = { perUser: number; total: number };

export class SessionStore {
  private entries = new Map<string, SessionEntry>();
  private pending = new Map<string, Promise<SessionEntry>>();
  private readonly idleMs: number;
  private readonly now: () => number;
  private readonly create: CreateSession;
  private readonly limits: Limits;

  constructor(opts: { idleMs: number; now?: () => number; create: CreateSession; limits?: Partial<Limits> }) {
    this.idleMs = opts.idleMs;
    this.now = opts.now ?? Date.now;
    this.create = opts.create;
    this.limits = { perUser: 3, total: 50, ...opts.limits };
  }

  get(owner: SessionOwner): SessionEntry | undefined {
    const e = this.entries.get(sessionKey(owner));
    return e?.retired ? undefined : e;
  }

  private keysOf(userId: string): string[] {
    return [...this.entries.keys(), ...this.pending.keys()].filter((k) => k.startsWith(`${userId}:`));
  }

  private makeRoom(userId: string, key: string): Promise<void> | undefined {
    const mine = this.keysOf(userId).filter((k) => k !== key);
    let freed: Promise<void> | undefined;
    if (mine.length >= this.limits.perUser) {
      const idle = mine
        .map((k) => [k, this.entries.get(k)] as const)
        .filter((x): x is readonly [string, SessionEntry] => !!x[1] && !x[1].busy)
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (!idle) throw new SessionCapacityError();
      freed = this.drop(idle[0]);
    }
    if (this.entries.size + this.pending.size >= this.limits.total) throw new SessionCapacityError();
    return freed;
  }

  getOrCreate(owner: SessionOwner, ctx: UserContext | null, persona: AgentPersona, seed?: SessionSeed): Promise<SessionEntry> {
    const key = sessionKey(owner);
    const existing = this.entries.get(key);
    if (existing && !(existing.retired && !existing.busy)) {
      existing.lastUsed = this.now();
      return Promise.resolve(existing);
    }
    const stale = existing ? this.drop(key) : undefined;
    const waiting = this.pending.get(key);
    if (waiting) return waiting;
    let freed: Promise<void> | undefined;
    try {
      freed = this.makeRoom(owner.user.id, key);
    } catch (err) {
      return Promise.reject(err);
    }
    const p = (async () => {
      await stale;
      await freed;
      const e = await this.create(owner, ctx, persona, seed);
      e.lastUsed = this.now();
      this.entries.set(key, e);
      return e;
    })();
    this.pending.set(key, p);
    void p.then(
      () => this.pending.delete(key),
      () => this.pending.delete(key),
    );
    return p;
  }

  touch(owner: SessionOwner): void {
    const e = this.entries.get(sessionKey(owner));
    if (e) e.lastUsed = this.now();
  }

  private async drop(key: string): Promise<void> {
    const e = this.entries.get(key);
    if (!e) return;
    this.entries.delete(key);
    await e.dispose().catch((err: unknown) => log.error(`[session] dispose failed key=${key}`, err));
  }

  async sweep(): Promise<void> {
    const cutoff = this.now() - this.idleMs;
    for (const [key, e] of [...this.entries]) if (!e.busy && e.lastUsed < cutoff) await this.drop(key);
  }

  async release(owner: SessionOwner, entry: SessionEntry): Promise<void> {
    const key = sessionKey(owner);
    if (entry.retired && !entry.busy && this.entries.get(key) === entry) await this.drop(key);
  }

  async retireUser(userId: string): Promise<void> {
    await Promise.allSettled(this.keysOf(userId).flatMap((k) => (this.pending.get(k) ? [this.pending.get(k)!] : [])));
    for (const key of this.keysOf(userId)) {
      const e = this.entries.get(key);
      if (!e) continue;
      if (e.busy) e.retired = true;
      else await this.drop(key);
    }
  }

  async disposeUser(userId: string): Promise<void> {
    await Promise.allSettled(this.keysOf(userId).flatMap((k) => (this.pending.get(k) ? [this.pending.get(k)!] : [])));
    for (const key of this.keysOf(userId)) {
      const e = this.entries.get(key);
      if (e?.busy) await e.session.abort().catch(() => {});
      await this.drop(key);
    }
  }

  async disposeAll(): Promise<void> {
    await Promise.allSettled([...this.pending.values()]);
    const all = [...this.entries.values()];
    this.entries.clear();
    await Promise.allSettled(all.map((e) => e.dispose()));
  }
}

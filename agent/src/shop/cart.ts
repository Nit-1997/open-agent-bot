import type { CartEdits, CartEntity } from "../../../shared/workspace.js";
import type { Tile } from "./extract.js";
import type { StoreResult } from "./rank.js";

export type CartItem = { query: string; qty: number };

const key = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ");

export class ActiveCart {
  onSave?: (state: CartEntity) => void;
  stores: string[] = [];
  scope: string[] = [];
  items: CartItem[] = [];
  private homes = new Map<string, string>();
  private picks = new Map<string, Map<string, Tile[]>>();

  static from(state: CartEntity): ActiveCart {
    const cart = new ActiveCart();
    cart.load(state);
    return cart;
  }

  load(state: CartEntity): void {
    this.stores = [...state.stores];
    this.scope = [...state.scope];
    this.items = state.items.map((i) => ({ ...i }));
    this.homes = new Map(Object.entries(state.homes));
    this.picks = new Map(
      Object.entries(state.picks).map(([store, m]) => [store, new Map(Object.entries(m).map(([k, v]) => [k, v as unknown as Tile[]]))]),
    );
  }

  snapshot(): CartEntity {
    return {
      stores: [...this.stores],
      scope: [...this.scope],
      items: this.items.map((i) => ({ ...i })),
      homes: Object.fromEntries(this.homes),
      picks: Object.fromEntries([...this.picks].map(([store, m]) => [store, Object.fromEntries(m)])),
    } as CartEntity;
  }

  save(): void {
    this.onSave?.(this.snapshot());
  }

  get empty(): boolean {
    return !this.items.length;
  }

  has(query: string): boolean {
    return this.items.some((i) => key(i.query) === key(query));
  }

  start(stores: string[], items: CartItem[]): void {
    this.stores = stores;
    this.scope = [];
    this.items = [];
    this.homes.clear();
    this.picks.clear();
    this.add(items);
  }

  add(items: CartItem[]): CartItem[] {
    const added: CartItem[] = [];
    for (const i of items) {
      const existing = this.items.find((x) => key(x.query) === key(i.query));
      if (existing) existing.qty = i.qty;
      else {
        this.items.push({ ...i });
        added.push(i);
      }
    }
    return added;
  }

  remove(queries: string[]): void {
    const gone = new Set(queries.map(key));
    this.items = this.items.filter((i) => !gone.has(key(i.query)));
  }

  addResults(results: StoreResult[]): void {
    for (const r of results) {
      if (this.scope.length && !this.scope.includes(r.store)) continue;
      if (r.home) this.homes.set(r.store, r.home);
      const m = this.picks.get(r.store) ?? new Map<string, Tile[]>();
      for (const i of r.items) m.set(key(i.query), i.picks);
      this.picks.set(r.store, m);
    }
  }

  scopeTo(stores: string[]): void {
    this.scope = stores;
  }

  applyEdits(e: CartEdits): void {
    if (e.removed?.length) this.remove(e.removed);
    for (const [q, n] of Object.entries(e.qty ?? {})) {
      const item = this.items.find((i) => key(i.query) === key(q));
      if (item) item.qty = n;
    }
    for (const [store, chosen] of Object.entries(e.picks ?? {})) {
      const m = this.picks.get(store);
      if (!m) continue;
      for (const [q, title] of Object.entries(chosen)) {
        const list = m.get(key(q));
        const n = list?.findIndex((t) => t.title === title) ?? -1;
        if (list && n > 0) m.set(key(q), [list[n], ...list.filter((_, i) => i !== n)]);
      }
    }
    this.save();
  }

  view(): StoreResult[] {
    const stores = this.scope.length ? this.scope : [...this.picks.keys()];
    return stores.map((store) => ({
      store,
      home: this.homes.get(store),
      items: this.items.map((i) => ({ query: i.query, qty: i.qty, picks: this.picks.get(store)?.get(key(i.query)) ?? [] })),
    }));
  }
}

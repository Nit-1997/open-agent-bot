export type Vertical = "retail" | "stays" | "flights" | "dining" | "events";

export type Source<Q, R, C = undefined> = {
  id: string;
  vertical: Vertical;
  regions: string[];
  capabilities: string[];
  defaultFor?: string[];
  search(q: Q, ctx: C): Promise<R>;
};

export type AnySource = Source<any, any, any>;

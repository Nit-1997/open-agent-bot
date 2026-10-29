import type { AnySource, Vertical } from "./types.js";

export type Selector = { vertical: Vertical; region?: string; capability?: string };

const ANY = "*";

export class SourceRegistry {
  private sources: AnySource[] = [];

  register<S extends AnySource>(source: S): S {
    this.unregister(source.vertical, source.id);
    this.sources.push(source);
    return source;
  }

  unregister(vertical: Vertical, id: string): void {
    this.sources = this.sources.filter((s) => !(s.vertical === vertical && s.id === id));
  }

  get<S extends AnySource>(vertical: Vertical, id: string): S | undefined {
    return this.sources.find((s) => s.vertical === vertical && s.id === id) as S | undefined;
  }

  select<S extends AnySource = AnySource>({ vertical, region, capability }: Selector): S[] {
    const code = region?.toUpperCase();
    return this.sources.filter(
      (s) =>
        s.vertical === vertical &&
        (!code || s.regions.includes(ANY) || s.regions.some((r) => r.toUpperCase() === code)) &&
        (!capability || s.capabilities.includes(capability)),
    ) as S[];
  }

  defaults<S extends AnySource = AnySource>({ vertical, region, kind }: { vertical: Vertical; region: string; kind?: string }): S[] {
    const code = region.toUpperCase();
    const tags = [...(kind ? [`${code}:${kind}`] : []), code, ...(kind ? [`${ANY}:${kind}`] : []), ANY];
    const pool = this.sources.filter((s) => s.vertical === vertical);
    for (const tag of tags) {
      const hit = pool.filter((s) => s.defaultFor?.includes(tag));
      if (hit.length) return hit as S[];
    }
    return [];
  }

  copy(): SourceRegistry {
    const next = new SourceRegistry();
    next.sources = [...this.sources];
    return next;
  }
}

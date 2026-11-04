import { searchSource } from "../../stays/search.js";
import type { StaySource } from "../../stays/types.js";

type Def = Pick<StaySource, "id" | "label" | "site" | "lists" | "searchUrl" | "read"> & Partial<Pick<StaySource, "regions" | "defaultFor">>;

export function staySource(def: Def): StaySource {
  const source: StaySource = {
    vertical: "stays",
    regions: ["*"],
    capabilities: def.lists,
    ...def,
    search: (q, ctx) => searchSource(source, q, ctx.openTab, ctx.live, ctx),
  };
  return source;
}

import type { UiBlock, UiWidget } from "@oab/shared/widgets";
import type { Evidence } from "./evidence.js";

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) if (k !== "url" && k !== "image" && k !== "type" && k !== "tone") strings(x, out);
  return out;
}

export function groundUi(widget: UiWidget, evidence: Evidence): UiWidget {
  let removed = 0;
  const blocks = widget.blocks.flatMap((b): UiBlock[] => {
    if (b.type === "list") {
      const items = b.items.map(({ url, ...rest }) => {
        if (url === undefined || evidence.hasUrl(url)) return url === undefined ? rest : { ...rest, url };
        removed++;
        return rest;
      });
      return [{ ...b, items }];
    }
    if (b.type === "cards") {
      const items = b.items.map(({ url, image, ...rest }) => {
        const item: typeof rest & { url?: string; image?: string } = { ...rest };
        if (image !== undefined && evidence.hasUrl(image)) item.image = image;
        if (url !== undefined) {
          if (evidence.hasUrl(url)) item.url = url;
          else removed++;
        }
        return item;
      });
      return [{ ...b, items }];
    }
    if (b.type === "image") return evidence.hasUrl(b.url) ? [b] : [];
    if (b.type === "links") {
      const items = b.items.filter((i) => evidence.hasUrl(i.url));
      removed += b.items.length - items.length;
      return items.length ? [{ ...b, items }] : [];
    }
    return [b];
  });
  const unverified = [
    ...new Set(
      strings([widget.title, widget.subtitle, blocks]).flatMap((s) => evidence.unverified(s).filter((c) => !c.startsWith("http"))),
    ),
  ];
  const out: UiWidget = { ...widget, blocks };
  if (unverified.length) out.unverified = unverified;
  if (removed) out.removedLinks = removed;
  return out;
}

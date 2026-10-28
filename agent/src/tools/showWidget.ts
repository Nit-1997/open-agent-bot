import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fitWidget, UI_BLOCK_TYPES, type UiWidget, validateWidget } from "../../../shared/widgets.js";
import { fail, ok, type ToolResult } from "./result.js";

const BLOCKS_HELP = `Keep it lean: a short title (under 60 chars), at most 8 blocks, labels not sentences. Blocks, in display order:
- {type:"heading", text}
- {type:"text", text} (2 sentences max)
- {type:"stats", items:[{label, value, note?}]} for a few key numbers
- {type:"table", columns:[...], rows:[[...]]} for comparisons; every cell is text
- {type:"list", items:[{title, subtitle?, value?, badge?, url?}]} for products, places, options (up to 10; subtitle a few words)
- {type:"cards", shape?:"square"|"wide", items:[{title, subtitle?, image?, url?, price?, rating?, source?, place?, note?, badge?}]} a scrollable row of picture cards (up to 10). square: products, albums, playlists, books. wide: hotels, places, restaurants, articles. place is a name and city for a map link. Use image URLs listed under "images:" in pages you read or returned by image_search; leave image out rather than guess one
- {type:"image", url, caption?, source?} one picture for a place, landmark, or research topic, from image_search or a page you read
- {type:"checklist", title?, items:[{text, note?}]} for to-dos, steps, menus (shopping lists go in cards)
- {type:"links", items:[{label, url}]}
- {type:"callout", tone:"info"|"warning"|"success", text} (one short sentence, only if it changes a decision)`;

function textify(v: unknown): unknown {
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(textify);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "type" || k === "tone" ? x : textify(x)]));
  return v;
}

type FindImage = (name: string, source?: string) => Promise<string | undefined>;

const MUSIC_HOSTS: Record<string, string> = { "open.spotify.com": "Spotify", "music.apple.com": "Apple Music", "music.youtube.com": "YouTube Music" };
const MUSIC_WORDS = /\b(playlist|album|mixtape|soundtrack)\b/i;

type ListItem = { title?: unknown; subtitle?: unknown; value?: unknown; badge?: unknown; url?: unknown };

function musicSource(it: ListItem): string | undefined {
  try {
    const host = new URL(String(it.url)).hostname.replace(/^www\./, "");
    if (MUSIC_HOSTS[host]) return MUSIC_HOSTS[host];
  } catch {}
  return MUSIC_WORDS.test(`${it.title ?? ""} ${it.subtitle ?? ""}`) ? "" : undefined;
}

export function musicListsToCards(blocks: unknown): unknown {
  if (!Array.isArray(blocks)) return blocks;
  return blocks.map((b) => {
    if (!b || typeof b !== "object" || (b as { type?: unknown }).type !== "list") return b;
    const items = (b as { items?: unknown }).items;
    if (!Array.isArray(items) || items.length < 2) return b;
    const sources = (items as ListItem[]).map(musicSource);
    if (sources.filter((s) => s !== undefined).length * 2 < items.length) return b;
    return {
      type: "cards",
      shape: "square",
      items: (items as ListItem[]).map((it, i) => ({
        title: it.title,
        ...(it.subtitle !== undefined && { subtitle: it.subtitle }),
        ...(it.value !== undefined && { note: it.value }),
        ...(it.badge !== undefined && { badge: it.badge }),
        ...(it.url !== undefined && { url: it.url }),
        ...(sources[i] && { source: sources[i] }),
      })),
    };
  });
}

async function fillImages(widget: UiWidget, findImage: FindImage, isSourced: (url: string) => boolean): Promise<{ widget: UiWidget; sourced: string[] }> {
  const sourced: string[] = [];
  const blocks = await Promise.all(
    widget.blocks.map(async (b) => {
      if (b.type !== "cards") return b;
      const items = await Promise.all(
        b.items.map(async (it) => {
          if (it.image && isSourced(it.image)) return it;
          const image = await findImage(it.title, it.source).catch(() => undefined);
          if (!image) return it.image ? { ...it, image: undefined } : it;
          sourced.push(`image: ${image}`);
          return { ...it, image };
        }),
      );
      return { ...b, items };
    }),
  );
  return { widget: { ...widget, blocks }, sourced };
}

export const showUiTool = (deps: { findImage?: FindImage; isSourced?: (url: string) => boolean } = {}) =>
  defineTool({
    name: "show_ui",
    label: "show_ui",
    description: `Show the user a card you compose from blocks. Use it for comparisons, plans, menus, checklists, summaries, or anything easier to scan than prose. Only put prices, ratings, stock status, and links in it that a tool returned; anything else is marked unverified and unsourced links are removed.\n\n${BLOCKS_HELP}`,
    parameters: Type.Object({
      title: Type.String(),
      subtitle: Type.Optional(Type.String()),
      blocks: Type.Union([Type.Array(Type.Object({ type: Type.Enum(UI_BLOCK_TYPES) }, { additionalProperties: true })), Type.String()], {
        description: BLOCKS_HELP,
      }),
    }),
    async execute(_id, params): Promise<ToolResult> {
      let blocks: unknown = params.blocks;
      if (typeof blocks === "string") {
        try {
          blocks = JSON.parse(blocks);
        } catch {
          return fail("invalid card:\n/blocks: blocks must be an array of block objects, not text");
        }
      }
      const r = validateWidget(fitWidget({ kind: "ui", ...(textify({ ...params, blocks: musicListsToCards(blocks) }) as object) }));
      if (!r.ok) return fail(`invalid card:\n${r.errors.join("\n")}`);
      const filled = deps.findImage ? await fillImages(r.value as UiWidget, deps.findImage, deps.isSourced ?? (() => true)) : { widget: r.value as UiWidget, sourced: [] };
      return ok(
        "Card shown. Now reply in at most two short sentences: the takeaway and the next step. Don't repeat the card, don't list what failed beyond a few words, and don't add bullets.",
        { widget: filled.widget, ...(filled.sourced.length && { sourced: filled.sourced.join("\n") }) },
      );
    },
  });

export const suggestRepliesTool = () =>
  defineTool({
    name: "suggest_replies",
    label: "suggest_replies",
    description:
      "Show 2-4 tappable follow-ups under your reply, written as the user would say them (under 40 characters), e.g. [\"Make it high protein\", \"Gluten-free options\", \"Compare with Costco\"]. Each should refine or extend what you just answered.",
    parameters: Type.Object({
      replies: Type.Union([Type.Array(Type.String()), Type.String()], { description: "2-4 short follow-ups" }),
    }),
    async execute(_id, params): Promise<ToolResult> {
      let replies: unknown = params.replies;
      if (typeof replies === "string") {
        try {
          replies = JSON.parse(replies);
        } catch {
          replies = [replies];
        }
      }
      const r = validateWidget(fitWidget({ kind: "followups", replies }));
      if (!r.ok) return fail(`invalid replies:\n${r.errors.join("\n")}`);
      return ok("Follow-ups shown. Don't repeat them in your text.", { widget: r.value });
    },
  });

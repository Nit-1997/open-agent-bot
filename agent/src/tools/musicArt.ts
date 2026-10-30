import type { Judge } from "../judge/index.js";
import { coverMatch } from "../judge/criteria/coverMatch.js";
import { type ITunes, pickMusic } from "./lookup.js";
import { timeoutSignal } from "./net.js";
import { withRetry } from "../lib/retry.js";

const UA = { "user-agent": "OpenAgent/0.1 (personal assistant prototype)" };
const SPOTIFY_ITEM = /^\/(?:intl-[a-z-]+\/)?(playlist|album|track|artist)\/([A-Za-z0-9]+)/;
const FILLER = new Set(["playlist", "playlists", "spotify", "apple", "music", "songs", "song", "mix", "the", "and", "for", "of", "by", "best"]);

type MusicCard = { title: string; url?: string; subtitle?: string };

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !FILLER.has(w)),
  );

export function spotifyItemUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    if (u.hostname !== "open.spotify.com") return undefined;
    const m = SPOTIFY_ITEM.exec(u.pathname);
    return m ? `https://open.spotify.com/${m[1]}/${m[2]}` : undefined;
  } catch {
    return undefined;
  }
}

async function spotifyCover(url: string, f: typeof fetch): Promise<string | undefined> {
  const api = new URL("https://open.spotify.com/oembed");
  api.searchParams.set("url", url);
  const res = await f(api, { signal: timeoutSignal(6000), headers: UA });
  if (!res.ok) return undefined;
  const thumb = ((await res.json()) as { thumbnail_url?: unknown }).thumbnail_url;
  return typeof thumb === "string" && thumb.startsWith("https://") ? thumb : undefined;
}

type ITunesAlbum = { collectionName?: string; artistName?: string; artworkUrl100?: string };

export function confidentAlbum(results: ITunesAlbum[], name: string): ITunesAlbum | undefined {
  const want = words(name);
  if (!want.size) return undefined;
  const need = Math.max(1, Math.ceil(want.size / 2));
  let best: ITunesAlbum | undefined;
  let bestHits = 0;
  for (const r of results) {
    const have = words(`${r.collectionName ?? ""} ${r.artistName ?? ""}`);
    let hits = 0;
    for (const w of want) if (have.has(w)) hits++;
    if (hits > bestHits && r.artworkUrl100) {
      best = r;
      bestHits = hits;
    }
  }
  return bestHits >= need ? best : undefined;
}

export function coverQueries(name: string): string[] {
  const clean = name.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
  const key = [...words(clean)];
  return [...new Set([clean, key.slice(0, 3).join(" "), key.slice(0, 2).join(" "), key[0] ?? ""].filter(Boolean))];
}

async function appleCover(card: MusicCard, country: string, f: typeof fetch, judge?: Judge): Promise<string | undefined> {
  const queries = coverQueries(card.title);
  const artist = card.subtitle?.replace(/[^\p{L}\p{N}' -]+/gu, " ").replace(/\s+/g, " ").trim();
  for (const q of artist ? [...new Set([`${queries[0]} ${artist}`, ...queries])] : queries) {
    const hit = await pickAlbum(await appleSearch(q, country, f), card, judge);
    if (hit) return large(hit.artworkUrl100);
  }
  if (!artist) return undefined;
  const song = `${queries[0]} ${artist}`;
  return large((await pickMusic(await appleSearch(song, country, f, "song"), song, "song", judge))?.artworkUrl100);
}

const large = (art: string | undefined) => art?.replace(/\/\d+x\d+bb\./, "/600x600bb.");

async function pickAlbum(results: ITunesAlbum[], card: MusicCard, judge?: Judge): Promise<ITunesAlbum | undefined> {
  const albums = results.filter((r) => r.artworkUrl100);
  if (judge?.available && albums.length) {
    const options = Object.fromEntries(albums.map((r, i) => [`c${i}`, `${r.collectionName ?? ""} by ${r.artistName ?? ""}`]));
    const verdict = await judge.choose({ card: [card.title, card.subtitle].filter(Boolean).join(" — ") }, options, coverMatch);
    if (verdict) return verdict.choice == null ? undefined : albums[Number(verdict.choice.slice(1))];
  }
  return confidentAlbum(albums, card.title);
}

async function appleSearch(name: string, country: string, f: typeof fetch, entity: "album" | "song" = "album"): Promise<ITunes[]> {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", name);
  url.searchParams.set("entity", entity);
  url.searchParams.set("limit", "8");
  url.searchParams.set("country", country);
  const res = await f(url, { signal: timeoutSignal(6000), headers: UA });
  if (!res.ok) return [];
  return ((await res.json()) as { results?: ITunes[] }).results ?? [];
}

export function musicCover(deps: { country: string; fetch?: typeof fetch; judge?: Judge }) {
  const f = withRetry(deps.fetch ?? fetch);
  return async (card: MusicCard): Promise<string | undefined> => {
    const spotify = spotifyItemUrl(card.url);
    if (spotify) {
      const cover = await spotifyCover(spotify, f).catch(() => undefined);
      if (cover) return cover;
    }
    return appleCover(card, deps.country, f, deps.judge).catch(() => undefined);
  };
}

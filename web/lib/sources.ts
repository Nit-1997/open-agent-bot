export type Source = { url: string; title: string; host: string };

export function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

const source = (url: string, title?: string): Source | null => {
  const host = hostOf(url);
  return host ? { url, title: title?.trim() || host, host } : null;
};

const present = (s: Source | null): s is Source => s !== null;

export function searchResults(text: string): Source[] {
  return [...text.matchAll(/^\s*\d+\.\s+(.+?)\s+—\s+(https?:\/\/\S+)/gm)].map((m) => source(m[2], m[1])).filter(present);
}

export function linksIn(markdown: string): Source[] {
  const out: Source[] = [];
  const md = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  for (const m of markdown.matchAll(md)) out.push(...[source(m[2], m[1])].filter(present));
  const bare = markdown.replace(md, " ");
  for (const m of bare.matchAll(/https?:\/\/[^\s<>()[\]"']+/g)) out.push(...[source(m[0].replace(/[.,;:!?]+$/, ""))].filter(present));
  return out;
}

export function dedupeSources(lists: Source[][]): Source[] {
  const byKey = new Map<string, Source>();
  for (const s of lists.flat()) {
    const key = s.url.replace(/[?#].*$/, "").replace(/\/+$/, "").replace(/^https?:\/\/(www\.)?/, "");
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, { ...s });
    else if (prev.title === prev.host && s.title !== s.host) prev.title = s.title;
  }
  return [...byKey.values()];
}

export function faviconUrl(host: string): string {
  return `https://icons.duckduckgo.com/ip3/${host}.ico`;
}

export { source as toSource };

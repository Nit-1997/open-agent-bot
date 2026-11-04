const OPEN = "<followups>";
const CLOSE = "</followups>";

export function parseFollowups(body: string): string[] {
  return body
    .split(/[|\n]/)
    .map((s) => s.replace(/^[\s\-*•\d.)"'“]+|["'”\s]+$/g, "").trim())
    .filter(Boolean);
}

function partialOpenAt(s: string): number {
  for (let n = Math.min(OPEN.length - 1, s.length); n > 0; n--) if (OPEN.startsWith(s.slice(-n))) return s.length - n;
  return s.length;
}

export function createFollowupSplitter() {
  let pending = "";
  let inTag = false;
  let replies: string[] | null = null;

  return {
    push(delta: string): string {
      pending += delta;
      let visible = "";
      while (pending) {
        if (inTag) {
          const end = pending.indexOf(CLOSE);
          if (end < 0) break;
          replies ??= parseFollowups(pending.slice(0, end));
          pending = pending.slice(end + CLOSE.length);
          inTag = false;
          continue;
        }
        const start = pending.indexOf(OPEN);
        if (start >= 0) {
          visible += pending.slice(0, start);
          pending = pending.slice(start + OPEN.length);
          inTag = true;
          continue;
        }
        const keep = partialOpenAt(pending);
        visible += pending.slice(0, keep);
        pending = pending.slice(keep);
        break;
      }
      return visible;
    },
    flush(): string {
      const rest = inTag ? "" : pending;
      if (inTag) replies ??= parseFollowups(pending);
      pending = "";
      inTag = false;
      return rest;
    },
    take(): string[] | null {
      const r = replies;
      replies = null;
      return r;
    },
  };
}

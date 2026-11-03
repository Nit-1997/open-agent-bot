export function highlightParts(text: string, query: string): Array<{ text: string; match: boolean }> {
  const needle = query.toLowerCase();
  const hay = text.toLowerCase();
  if (!needle || hay.length !== text.length) return [{ text, match: false }];
  const parts: Array<{ text: string; match: boolean }> = [];
  let at = 0;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) {
    if (i > at) parts.push({ text: text.slice(at, i), match: false });
    parts.push({ text: text.slice(i, i + needle.length), match: true });
    at = i + needle.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), match: false });
  return parts.length ? parts : [{ text, match: false }];
}

export function Highlight(props: { id: string; text: string; query: string }) {
  return (
    <>
      {highlightParts(props.text, props.query).map((p, i) =>
        p.match ? (
          <mark id={`${props.id}-mark-${i}`} key={i} className="rounded-sm bg-mist-100 px-0.5 text-text-primary">
            {p.text}
          </mark>
        ) : (
          <span id={`${props.id}-text-${i}`} key={i}>
            {p.text}
          </span>
        ),
      )}
    </>
  );
}

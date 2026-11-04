export function redact(text: string, tokens: readonly (string | undefined)[]): string {
  let out = text;
  for (const t of tokens) if (t) out = out.split(t).join("[token]");
  return out;
}

export function keyHint(value: string): string {
  const v = value.trim();
  if (v.length < 20) return `…${v.slice(-2)}`;
  const head = v.slice(0, 8);
  const cut = Math.max(head.lastIndexOf("-"), head.lastIndexOf("_"));
  return `${cut >= 0 ? head.slice(0, cut + 1) : ""}…${v.slice(-4)}`;
}

export function oauthHint(email: unknown): string {
  return typeof email === "string" && email.includes("@") ? `Signed in · ${email.slice(0, 60)}` : "Signed in";
}

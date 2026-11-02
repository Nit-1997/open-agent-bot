export function newNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

export function contentSecurityPolicy(nonce: string, supabaseUrl: string, dev: boolean, frameOrigins: string[] = []): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self'",
    ["frame-src 'self'", ...frameOrigins].join(" "),
    "frame-ancestors 'none'",
    `form-action 'self' https://accounts.google.com ${supabaseUrl}`,
    "base-uri 'none'",
    "object-src 'none'",
  ].join("; ");
}

export const ARTIFACT_SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox";

export const ARTIFACT_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src data:",
  "media-src 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "manifest-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  `sandbox ${ARTIFACT_SANDBOX}`,
].join("; ");

export const ARTIFACT_ID_RE = /^[A-Za-z0-9_-]{12}$/;

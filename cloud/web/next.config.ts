import { createRequire } from "node:module";
import path from "node:path";
import type { NextConfig } from "next";

const require = createRequire(import.meta.url);
const resolveFromWeb = (specifier: string) => {
  const relative = path.relative(__dirname, require.resolve(specifier));
  return relative.startsWith(".") ? relative : `./${relative}`;
};

const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  transpilePackages: ["@oab/ui", "@oab/bff"],
  outputFileTracingRoot: path.join(__dirname, "../.."),
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: "/:path((?!api/artifacts/).*)", headers: [{ key: "X-Frame-Options", value: "DENY" }] },
    ];
  },
  turbopack: {
    root: path.join(__dirname, "../.."),
    resolveAlias: {
      typebox: resolveFromWeb("typebox"),
      "typebox/value": resolveFromWeb("typebox/value"),
    },
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

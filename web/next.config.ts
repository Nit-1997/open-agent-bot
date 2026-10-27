import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, ".."),
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    root: path.join(__dirname, ".."),
    resolveAlias: {
      typebox: "./node_modules/typebox/build/index.mjs",
      "typebox/value": "./node_modules/typebox/build/value/index.mjs",
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

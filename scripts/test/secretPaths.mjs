export const ENV_FILE_NAMES = Object.freeze([
  ".env-agent",
  ".env-renderer",
  ".env-nextjs",
  ".env-caddy",
  ".env-llm",
  ".env-search",
  "env-files/.env-supabase-admin",
  "env-files/.env-e2e",
]);

export const ENV_TARGETS = Object.freeze(["backend", "frontend", "ops"].map((g) => `cloud/deploy-config/env-files/${g}/.env`));

export const ENV_EXAMPLES = Object.freeze(ENV_TARGETS.map((t) => `${t}.example`));

export const SECRET_PATHS = Object.freeze([
  ".env",
  ...ENV_FILE_NAMES.map((name) => `deploy-config/${name}`),
  ...ENV_FILE_NAMES.map((name) => `cloud/deploy/${name}`),
  ...ENV_TARGETS,
  "cloud/deploy-config/env-files/backend/notes.txt",
  "cloud/deploy-config/env-files/notes.txt",
  "deploy-config/env-files/anything",
  "e2e/.auth/x.json",
  "e2e/test-results/trace.zip",
  "e2e/playwright-report/index.html",
  "cloud/e2e/.auth/x.json",
  "cloud/e2e/test-results/trace.zip",
  "cloud/e2e/playwright-report/index.html",
  "cloud/deploy/.env",
  "cloud/deploy/env-files/notes.txt",
  "cloud/web/.env.local",
  "cloud/agent/.env",
  "web/.env.local",
  "packages/core/.env",
  "cloud/supabase/.temp/project-ref",
  "cloud/supabase/.branches/_current_branch",
  ".vercel/project.json",
  "cloud/web/.vercel/project.json",
  "x.crt",
  "cloud/deploy/caddy/site.crt",
  "x.p12",
  "certs/client.p12",
]);

export const NEW_RULES = Object.freeze([
  "**/.env-*",
  "**/env-files/**",
  "**/.auth/",
  "cloud/e2e/test-results/",
  "cloud/e2e/playwright-report/",
]);

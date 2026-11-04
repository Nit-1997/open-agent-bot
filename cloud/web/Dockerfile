FROM node:22-slim AS build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/postinstall.mjs ./scripts/
COPY patches ./patches
COPY packages/shared/package.json packages/shared/
COPY packages/bff/package.json packages/bff/
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
COPY packages/local-web/package.json packages/local-web/
COPY apps/desktop/package.json apps/desktop/
COPY e2e/package.json e2e/
COPY cloud/agent/package.json cloud/agent/
COPY cloud/deploy/package.json cloud/deploy/
COPY cloud/e2e/package.json cloud/e2e/
COPY cloud/web/package.json cloud/web/
RUN npm ci -w @oab/cloud-web --include-workspace-root
COPY packages/shared ./packages/shared
COPY packages/bff ./packages/bff
COPY packages/ui ./packages/ui
COPY cloud/web ./cloud/web
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
RUN test -n "$NEXT_PUBLIC_SUPABASE_URL" && test -n "$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
  || { echo "Build with --env-file cloud/deploy/.env-nextjs so the NEXT_PUBLIC_SUPABASE_* build args are set" >&2; exit 1; }
RUN npm run build -w @oab/cloud-web

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/cloud/web/.next/standalone ./
COPY --from=build /app/cloud/web/.next/static ./cloud/web/.next/static
COPY --from=build /app/cloud/web/public ./cloud/web/public
USER node
EXPOSE 3000
CMD ["node", "cloud/web/server.js"]

FROM --platform=$BUILDPLATFORM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f AS ui
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
COPY web/package.json web/
COPY e2e/package.json e2e/
RUN npm ci -w @oab/local-web -w @oab/ui -w @oab/shared --include-workspace-root
COPY packages/shared/src packages/shared/src
COPY packages/ui/src packages/ui/src
COPY packages/local-web packages/local-web
RUN npm run build -w @oab/local-web && test -f packages/local-web/dist/index.html

FROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f
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
COPY web/package.json web/
COPY e2e/package.json e2e/
RUN npm ci -w @oab/core -w @oab/shared -w @oab/bff --include-workspace-root
RUN grep -q "closeAllConnections() { }" node_modules/@earendil-works/pi-ai/dist/auth/oauth/openai-chatgpt.js
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY packages/bff/tsconfig.json packages/bff/
COPY packages/bff/src packages/bff/src
COPY packages/core/tsconfig.json packages/core/
COPY packages/core/src packages/core/src
COPY packages/core/skills packages/core/skills
RUN npm run build -w @oab/core -w @oab/bff && npm prune --omit=dev -w @oab/core -w @oab/shared -w @oab/bff --include-workspace-root
COPY --from=ui /app/packages/local-web/dist packages/local-web/dist
RUN mkdir -p /data /keys /run/open-agent/renderer && chown pwuser:pwuser /data /keys /run/open-agent/renderer && chmod 700 /data /keys /run/open-agent/renderer
ARG OPEN_AGENT_VERSION=dev
ARG OPEN_AGENT_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/Nit-1997/open-agent-bot" \
      org.opencontainers.image.version="${OPEN_AGENT_VERSION}" \
      org.opencontainers.image.revision="${OPEN_AGENT_REVISION}" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.title="Open Agent"
USER pwuser
ENV NODE_ENV=production
ENV COPILOTKIT_TELEMETRY_DISABLED=true
ENV OPEN_AGENT_VERSION=${OPEN_AGENT_VERSION}
WORKDIR /app/packages/core
EXPOSE 8000
CMD ["node", "dist/server.js"]

FROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:47b510dd9230bf0b9bfc9b20102241e577ea7a99334ab4c3ca19f19770e9b8ea
RUN case "$(node -p process.versions.node)" in 24.*) ;; *) echo "the base image must ship Node 24, got $(node -p process.versions.node)" >&2; exit 1 ;; esac
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
COPY cloud/web/package.json cloud/web/
RUN npm ci -w @oab/cloud-agent -w @oab/core -w @oab/shared -w @oab/bff --include-workspace-root
RUN grep -q "closeAllConnections() { }" node_modules/@earendil-works/pi-ai/dist/auth/oauth/openai-chatgpt.js
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY packages/bff/tsconfig.json packages/bff/
COPY packages/bff/src packages/bff/src
COPY packages/core/tsconfig.json packages/core/
COPY packages/core/src packages/core/src
COPY packages/core/skills packages/core/skills
COPY cloud/agent/tsconfig.json cloud/agent/
COPY cloud/agent/src cloud/agent/src
RUN npm run build -w @oab/cloud-agent && npm prune --omit=dev -w @oab/cloud-agent -w @oab/core -w @oab/shared -w @oab/bff --include-workspace-root
USER pwuser
ENV NODE_ENV=production
ENV COPILOTKIT_TELEMETRY_DISABLED=true
WORKDIR /app/cloud/agent
EXPOSE 8000
CMD ["node", "dist/server.js"]

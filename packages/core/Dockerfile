FROM mcr.microsoft.com/playwright:v1.64.1-noble
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/postinstall.mjs ./scripts/
COPY patches ./patches
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY web/package.json web/
COPY e2e/package.json e2e/
RUN npm ci -w @oab/core -w @oab/shared --include-workspace-root
RUN grep -q "closeAllConnections() { }" node_modules/@earendil-works/pi-ai/dist/auth/oauth/openai-chatgpt.js
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY packages/core/tsconfig.json packages/core/
COPY packages/core/src packages/core/src
COPY packages/core/skills packages/core/skills
RUN npm run build -w @oab/core && npm prune --omit=dev -w @oab/core -w @oab/shared --include-workspace-root
USER pwuser
ENV NODE_ENV=production
ENV COPILOTKIT_TELEMETRY_DISABLED=true
WORKDIR /app/packages/core
EXPOSE 8000
CMD ["node", "dist/server.js"]

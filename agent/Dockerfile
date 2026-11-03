FROM mcr.microsoft.com/playwright:v1.64.1-noble
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/postinstall.mjs ./scripts/
COPY patches ./patches
COPY agent/package.json agent/
COPY web/package.json web/
COPY e2e/package.json e2e/
RUN npm ci -w agent --include-workspace-root
RUN grep -q "closeAllConnections() { }" node_modules/@earendil-works/pi-ai/dist/auth/oauth/openai-chatgpt.js
COPY shared ./shared
COPY agent/tsconfig.json agent/
COPY agent/src agent/src
COPY agent/skills agent/skills
RUN npm run build -w agent && npm prune --omit=dev -w agent --include-workspace-root
USER pwuser
ENV NODE_ENV=production
WORKDIR /app/agent
EXPOSE 8000
CMD ["node", "dist/agent/src/server.js"]

FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /app/agent
COPY agent/package.json agent/package-lock.json ./
RUN npm ci
COPY shared /app/shared
COPY agent/tsconfig.json ./
COPY agent/src ./src
COPY agent/skills ./skills
RUN npm run build && npm prune --omit=dev
USER pwuser
ENV NODE_ENV=production
EXPOSE 8000
CMD ["node", "dist/agent/src/server.js"]

FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /app/agent
COPY agent/package.json agent/package-lock.json ./
RUN npm ci
COPY shared /app/shared
COPY agent/tsconfig.json ./
COPY agent/src ./src
COPY agent/skills ./skills
RUN npm run build && npm prune --omit=dev
RUN groupadd -g 1500 agentsecret && usermod -aG agentsecret pwuser \
  && mkdir -p /data/agent /data/artifacts /data/shared \
  && chown -R pwuser:pwuser /data && chown pwuser:agentsecret /data/shared && chmod 2750 /data/shared
USER pwuser
ENV NODE_ENV=production
EXPOSE 8000
CMD ["node", "dist/agent/src/server.js"]

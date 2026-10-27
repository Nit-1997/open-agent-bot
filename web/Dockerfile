FROM node:22-slim AS build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY shared /app/shared
COPY web ./
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/web/.next/standalone ./
COPY --from=build /app/web/.next/static ./.next/static
COPY --from=build /app/web/public ./public
EXPOSE 3000
CMD ["node", "server.js"]

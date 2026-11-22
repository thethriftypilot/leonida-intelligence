# Leonida Intelligence — container image (Linux home server / NAS / Docker Desktop)
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production LI_HOST=0.0.0.0 LI_PORT=5180 LI_DATA_DIR=/app/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY scripts ./scripts
COPY seed ./seed
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 5180
VOLUME ["/app/data"]
HEALTHCHECK --interval=60s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.LI_PORT||5180)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]

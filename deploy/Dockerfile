# syntax=docker/dockerfile:1
# Build context = the REPOSITORY ROOT:  docker build -f deploy/Dockerfile .
# One image holds the NestJS server and the site it serves (client/). PostgreSQL is a separate container (docker-compose.prod.yml).

# ---------- build: install, generate the Prisma client, compile ----------
FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --ignore-scripts            # postinstall's `prisma generate` needs the schema, which is copied next
COPY server/ ./
RUN npx prisma generate && npm run build

# ---------- runtime ----------
FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3000 CLIENT_DIR=/app/client
WORKDIR /app/server
# node_modules stays whole (not --omit=dev): `prisma migrate deploy` (the CLI is a devDependency) runs from this image before every release
COPY --from=build --chown=node:node /app/server/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server/dist ./dist
COPY --from=build --chown=node:node /app/server/prisma ./prisma
COPY --from=build --chown=node:node /app/server/package.json ./package.json
COPY --chown=node:node client/ /app/client/
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# syntax=docker/dockerfile:1
# Build context = the REPOSITORY ROOT:  docker build -f deploy/Dockerfile .
# One image holds the NestJS server and the site it serves (client/ + the landing's Vite build). PostgreSQL is a separate container (docker-compose.prod.yml).

# ---------- build: install, generate the Prisma client, compile ----------
FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --ignore-scripts            # postinstall's `prisma generate` needs the schema, which is copied next
COPY client/shared/ /app/client/shared/
COPY shared/ /app/shared/
COPY server/ ./
RUN npx prisma generate && npm run build

# ---------- landing: the / page (Vite). It imports the game's cockpit + wallet modules from ../client, so client/ sits next to it ----------
# The whitepaper tests read the server files they quote, the prod compose flags, the program IDL, and this Dockerfile.
# Those files are not in the runtime image. A new quoted path has to be copied here or the image build fails.
FROM node:24-bookworm-slim AS landing
WORKDIR /app
COPY client/ ./client/
COPY shared/ ./shared/
COPY server/src/domain/rides/ride-tier.ts server/src/domain/rides/ride-rules.ts server/src/domain/rides/ride-challenge.ts ./server/src/domain/rides/
COPY server/src/domain/verdict/verdict-rules.ts ./server/src/domain/verdict/
COPY server/src/domain/telemetry/telemetry-rules.ts ./server/src/domain/telemetry/
COPY server/src/domain/live/live-rules.ts ./server/src/domain/live/
COPY server/src/domain/achievements/achievements.ts ./server/src/domain/achievements/
COPY server/src/infrastructure/config/env.schema.ts ./server/src/infrastructure/config/
COPY deploy/docker-compose.prod.yml deploy/Dockerfile ./deploy/
COPY .dockerignore ./
COPY programs/idl/freightchain_pools.json ./programs/idl/
WORKDIR /app/landing
COPY landing/package.json landing/package-lock.json ./
RUN npm ci
COPY landing/ ./
RUN npm test && npm run build          # the page-integrity + formatter tests gate the image; the size-budget tests run against dist/ in `npm run check`

# ---------- runtime ----------
FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3000 CLIENT_DIR=/app/client LANDING_DIR=/app/landing/dist
WORKDIR /app/server
# node_modules stays whole (not --omit=dev): `prisma migrate deploy` (the CLI is a devDependency) runs from this image before every release
COPY --from=build --chown=node:node /app/server/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server/dist ./dist
COPY --from=build --chown=node:node /app/server/prisma ./prisma
COPY --from=build --chown=node:node /app/server/package.json ./package.json
COPY --chown=node:node client/ /app/client/
COPY --chown=node:node shared/ /app/shared/
COPY --from=landing --chown=node:node /app/landing/dist /app/landing/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# syntax=docker/dockerfile:1
# Build context = the REPOSITORY ROOT:  docker build -f infra/deploy/Dockerfile .
# One image holds the NestJS server and the site it serves (frontend/client/ + the landing's Vite build). PostgreSQL is a separate container (docker-compose.prod.yml).

# ---------- build: install, generate the Prisma client, compile ----------
FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend/server
COPY backend/server/package.json backend/server/package-lock.json ./
RUN npm ci --ignore-scripts            # postinstall's `prisma generate` needs the schema, which is copied next
COPY frontend/client/shared/ /app/frontend/client/shared/
COPY frontend/shared/ /app/frontend/shared/
COPY backend/server/ ./
RUN npx prisma generate && npm run build

# ---------- landing: the / page (Vite). It imports the game's cockpit + wallet modules from ../client, so client/ sits next to it ----------
# The whitepaper tests read the server files they quote, the prod compose flags, the program IDL, and this Dockerfile.
# Those files are not in the runtime image. A new quoted path has to be copied here or the image build fails.
FROM node:24-bookworm-slim AS landing
WORKDIR /app
COPY frontend/client/ ./frontend/client/
COPY frontend/shared/ ./frontend/shared/
COPY backend/server/src/domain/rides/ride-tier.ts backend/server/src/domain/rides/ride-rules.ts backend/server/src/domain/rides/ride-challenge.ts ./backend/server/src/domain/rides/
COPY backend/server/src/domain/verdict/verdict-rules.ts ./backend/server/src/domain/verdict/
COPY backend/server/src/domain/telemetry/telemetry-rules.ts ./backend/server/src/domain/telemetry/
COPY backend/server/src/domain/live/live-rules.ts ./backend/server/src/domain/live/
COPY backend/server/src/domain/achievements/achievements.ts ./backend/server/src/domain/achievements/
COPY backend/server/src/infrastructure/config/env.schema.ts ./backend/server/src/infrastructure/config/
COPY infra/deploy/docker-compose.prod.yml infra/deploy/Dockerfile ./infra/deploy/
COPY .dockerignore ./
COPY backend/programs/idl/freightchain_pools.json ./backend/programs/idl/
# landing src/legal.js inlines the rules with ?raw
COPY docs/legal/ ./docs/legal/
WORKDIR /app/frontend/landing
COPY frontend/landing/package.json frontend/landing/package-lock.json ./
RUN npm ci
COPY frontend/landing/ ./
RUN npm test && npm run build          # the page-integrity + formatter tests gate the image; the size-budget tests run against dist/ in `npm run check`

# ---------- runtime ----------
FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3000 CLIENT_DIR=/app/frontend/client LANDING_DIR=/app/frontend/landing/dist
WORKDIR /app/backend/server
# node_modules stays whole (not --omit=dev): `prisma migrate deploy` (the CLI is a devDependency) runs from this image before every release
COPY --from=build --chown=node:node /app/backend/server/node_modules ./node_modules
COPY --from=build --chown=node:node /app/backend/server/dist ./dist
COPY --from=build --chown=node:node /app/backend/server/prisma ./prisma
COPY --from=build --chown=node:node /app/backend/server/package.json ./package.json
COPY --chown=node:node frontend/client/ /app/frontend/client/
COPY --chown=node:node frontend/shared/ /app/frontend/shared/
COPY --from=landing --chown=node:node /app/frontend/landing/dist /app/frontend/landing/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]

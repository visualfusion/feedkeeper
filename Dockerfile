# syntax=docker/dockerfile:1

# 1. Install production dependencies
FROM node:22-bookworm-slim AS dependencies

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/

RUN npm ci --omit=dev

# 2. Build backend and frontend artifacts
FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/

RUN npm ci

COPY server/ ./server/
COPY web/ ./web/

RUN npm run build

# 3. Production runtime
FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/app/data/feedkeeper.sqlite

# Create directory for persistent SQLite database and set permissions
RUN mkdir -p /app/data && chown -R node:node /app

# Copy production dependencies and package manifests
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node server/package.json ./server/
COPY --chown=node:node web/package.json ./web/
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules

# Copy built applications
COPY --from=builder --chown=node:node /app/server/dist ./server/dist
COPY --from=builder --chown=node:node /app/web/dist ./web/dist

USER node

EXPOSE 3000

VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/dist/feedkeeper.js"]

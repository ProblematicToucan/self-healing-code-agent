# self-healing-code — Node 24
# Multi-stage: build then slim runtime (better-sqlite3 built in builder, copied to runner)

FROM node:24-bookworm AS builder

WORKDIR /app

# Build tools for native modules (e.g. better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --production

# Production image
FROM node:24-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
# Pass at runtime: -e CURSOR_API_KEY=... or via compose
ENV CURSOR_API_KEY=

# Cursor agent CLI (for agent tooling inside the container)
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && curl https://cursor.com/install -fsS | bash \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# App writes SQLite DB to ./data
RUN mkdir -p /app/data

EXPOSE 3000

USER node
CMD ["node", "dist/index.js"]

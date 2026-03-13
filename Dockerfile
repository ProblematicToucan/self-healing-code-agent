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

# Git identity (used when committing from inside container). Override at runtime if needed.
ENV GIT_AUTHOR_NAME=
ENV GIT_AUTHOR_EMAIL=
ENV GIT_COMMITTER_NAME=
ENV GIT_COMMITTER_EMAIL=
# GitHub (or other) PAT for clone/push from inside container. Entrypoint configures Git credential helper when set.
ENV GIT_TOKEN=
ENV GIT_URL=

# Git, GitHub CLI, ca-certificates for pipeline clone/HTTPS. Cursor CLI is installed at runtime in entrypoint.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

RUN curl -sSL "https://raw.githubusercontent.com/upciti/wakemeops/main/assets/install_repository" | bash \
    && apt-get install glab

ENV PATH="/root/.local/bin:${PATH}"

COPY package.json package-lock.json* ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# App writes SQLite DB to ./data and clones repos into ./workspace
RUN mkdir -p /app/data /app/workspace

# Git credential helper + entrypoint so clone/push use GIT_TOKEN without prompts
COPY entrypoint.sh git-credential-helper.sh /app/
RUN chmod +x /app/entrypoint.sh /app/git-credential-helper.sh

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "dist/index.js"]

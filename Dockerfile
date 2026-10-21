FROM node:24-slim AS base
ARG WRENLORE_GIT_SHA=unknown
LABEL org.opencontainers.image.source="https://github.com/wrenlore/wrenlore"
LABEL org.opencontainers.image.revision="${WRENLORE_GIT_SHA}"

# Install and harden OS trust before any npm/pnpm network operation.
# OpenSSL-only mode excludes Node's separate bundled CA list.
ENV NODE_OPTIONS=--use-openssl-ca
COPY scripts/tls/ca-policy.mjs /opt/wrenlore/tls/ca-policy.mjs
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && node /opt/wrenlore/tls/ca-policy.mjs \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@10.4.0

FROM base AS builder

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM base AS installer

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl bash \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy apps
COPY --from=builder /app/apps/server/dist /app/apps/server/dist
COPY --from=builder /app/apps/client/dist /app/apps/client/dist
COPY --from=builder /app/apps/server/package.json /app/apps/server/package.json

# Copy packages
COPY --from=builder /app/packages/editor-ext/dist /app/packages/editor-ext/dist
COPY --from=builder /app/packages/editor-ext/package.json /app/packages/editor-ext/package.json

# Copy root package files
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/pnpm*.yaml /app/
COPY --from=builder /app/.npmrc /app/.npmrc

# Copy patches
COPY --from=builder /app/patches /app/patches

RUN chown -R node:node /app

USER node

RUN pnpm install --frozen-lockfile --prod

RUN mkdir -p /app/data/storage

VOLUME ["/app/data/storage"]

EXPOSE 3000

CMD ["pnpm", "start"]

# syntax=docker/dockerfile:1

# The optional collector has no Next build or dependency on another final image.
FROM oven/bun@sha256:3f23864d3e8c923975c61971cabe67ee3d5a728f1e25a559256b95af719a3478 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock bunfig.toml ./
COPY patches ./patches
RUN bun --no-env-file install --frozen-lockfile

FROM base AS prod-deps
COPY package.json bun.lock bunfig.toml ./
COPY patches ./patches
RUN bun --no-env-file install --frozen-lockfile --prod

FROM deps AS collector-build
COPY tsconfig.json ./
COPY src ./src
COPY scripts/build-operations-collector.mjs scripts/build-workers.mjs ./scripts/
RUN bun --no-env-file scripts/build-operations-collector.mjs

FROM base AS operations-collector
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json LICENSE ./
COPY third-party ./third-party
COPY --from=collector-build /app/dist/operations-collector.mjs ./dist/
USER 1000:1000
ARG APP_COMMIT
RUN printf '%s\n' "$APP_COMMIT" | grep -Eq '^[0-9a-f]{40}$'
ENV APP_COMMIT=${APP_COMMIT}
LABEL org.opencontainers.image.revision=${APP_COMMIT} \
      org.opencontainers.image.title="Warpdrive Operations Collector"
CMD ["bun", "--no-env-file", "dist/operations-collector.mjs", "/run/warpdrive-operations-config.json"]

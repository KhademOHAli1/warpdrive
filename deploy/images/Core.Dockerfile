# syntax=docker/dockerfile:1

# Build the optional Core API without Next output or the other service artifacts.
FROM oven/bun@sha256:7c8e62d7fb0b0b5178cc4396ed24f026591ddbff6ce654ff1022acf195bb581b AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock bunfig.toml ./
COPY patches ./patches
RUN bun install --frozen-lockfile

FROM base AS prod-deps
COPY package.json bun.lock bunfig.toml ./
COPY patches ./patches
RUN bun install --frozen-lockfile --prod

FROM deps AS core-build
COPY tsconfig.json ./
COPY src ./src
COPY scripts/build-core.mjs scripts/build-workers.mjs ./scripts/
RUN bun --no-env-file scripts/build-core.mjs

FROM base AS core-api
ENV NODE_ENV=production RUNTIME_COMPONENT=core-api
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json LICENSE ./
COPY third-party ./third-party
COPY --from=core-build /app/dist/core-api.mjs /app/dist/workflow-code-worker.mjs ./dist/
USER bun
ARG APP_COMMIT
ARG APP_VERSION=
RUN printf '%s\n' "$APP_COMMIT" | grep -Eq '^[0-9a-f]{40}$'
ENV APP_COMMIT=${APP_COMMIT} APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.revision=${APP_COMMIT} \
      org.opencontainers.image.title="Warpdrive Core API"
EXPOSE 3010
CMD ["bun", "--no-env-file", "dist/core-api.mjs"]

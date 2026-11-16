# syntax=docker/dockerfile:1

# Build from the repository root with --file deploy/images/Dockerfile --target COMPONENT.
# Non-web targets have no dependency on web-build, next build or .next. They share the
# locked production dependency layer because packages read runtime data from node_modules.
# Bun 1.4.4, resolved from the registry's linux/amd64 manifest. The immutable
# base is a component input; tag movement cannot silently change a reused build.
FROM oven/bun@sha256:3f23864d3e8c923975c61971cabe67ee3d5a728f1e25a559256b95af719a3478 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock bunfig.toml ./
COPY patches ./patches
RUN bun install --frozen-lockfile

FROM base AS prod-deps
COPY package.json bun.lock bunfig.toml ./
COPY patches ./patches
RUN bun install --frozen-lockfile --prod

FROM deps AS source
COPY . .

FROM source AS web-build
ARG APP_COMMIT
ARG NEXT_PUBLIC_WS_URL=same-origin
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}
RUN printf '%s\n' "$APP_COMMIT" | grep -Eq '^[0-9a-f]{40}$'
# Presentation compiles without a database, provider secrets, queue or live Core service.
RUN NODE_ENV=production \
    APP_COMMIT=${APP_COMMIT} \
    NEXT_DEPLOYMENT_ID=wd-${APP_COMMIT} \
    NEXT_TELEMETRY_DISABLED=1 \
    bun --bun next build --webpack
RUN bun scripts/build-workers.mjs --component web
# Builder caches stay on the builder. Runtime can create a fresh cache under its owned .next.
RUN rm -rf .next/cache

FROM source AS worker-build
RUN bun scripts/build-workers.mjs --component worker

FROM source AS realtime-build
RUN bun scripts/build-workers.mjs --component realtime

FROM source AS migrator-build
RUN bun scripts/build-workers.mjs --component migrator

FROM base AS runtime-base
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY LICENSE ./LICENSE
COPY third-party ./third-party
USER bun

FROM runtime-base AS web
ENV HOSTNAME=0.0.0.0 PORT=3000
COPY --chown=bun:bun --from=web-build /app/.next ./.next
COPY --from=web-build /app/public ./public
COPY --from=web-build /app/dist ./dist
COPY --from=web-build /app/dist/next.config.mjs ./next.config.mjs
ARG APP_COMMIT
ARG APP_VERSION=
RUN printf '%s\n' "$APP_COMMIT" | grep -Eq '^[0-9a-f]{40}$'
ENV APP_COMMIT=${APP_COMMIT} APP_VERSION=${APP_VERSION}
ENV NEXT_DEPLOYMENT_ID=wd-${APP_COMMIT}
LABEL org.opencontainers.image.revision=${APP_COMMIT} \
      org.opencontainers.image.title="Warpdrive Web"
EXPOSE 3000
CMD ["bun", "--bun", "next", "start"]

FROM runtime-base AS worker
COPY --from=worker-build /app/dist ./dist
ARG APP_COMMIT
ARG APP_VERSION=
RUN printf '%s\n' "$APP_COMMIT" | grep -Eq '^[0-9a-f]{40}$'
ENV APP_COMMIT=${APP_COMMIT} APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.revision=${APP_COMMIT} \
      org.opencontainers.image.title="Warpdrive Worker"
CMD ["bun", "dist/worker.mjs"]

FROM runtime-base AS realtime
COPY --from=realtime-build /app/dist ./dist
ARG APP_COMMIT
ARG APP_VERSION=
RUN printf '%s\n' "$APP_COMMIT" | grep -Eq '^[0-9a-f]{40}$'
ENV APP_COMMIT=${APP_COMMIT} APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.revision=${APP_COMMIT} \
      org.opencontainers.image.title="Warpdrive Realtime"
EXPOSE 8080
CMD ["bun", "dist/ws.mjs"]

FROM runtime-base AS migrator
COPY --from=migrator-build /app/dist ./dist
COPY --from=migrator-build /app/drizzle ./drizzle
ARG APP_COMMIT
ARG APP_VERSION=
RUN printf '%s\n' "$APP_COMMIT" | grep -Eq '^[0-9a-f]{40}$'
ENV APP_COMMIT=${APP_COMMIT} APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.revision=${APP_COMMIT} \
      org.opencontainers.image.title="Warpdrive Migrator"
CMD ["bun", "dist/migrate.mjs"]

# syntax=docker/dockerfile:1

# Use the admitted repository context with --file deploy/images/Web.Dockerfile --target web.
# This is the same Bun 1.4.5 Linux amd64 base as deploy/images/Dockerfile.
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

FROM base AS ui-deps
WORKDIR /web-ui
COPY tools/web-ui/package.json tools/web-ui/bun.lock ./
RUN bun --no-env-file install --frozen-lockfile --ignore-scripts --linker=hoisted --backend=copyfile
# Both packages are ESM. The app's existing dependency layer supplies React,
# React DOM and their runtime dependencies for both SDK entrypoints.
RUN test -f node_modules/@ui-sdk/core/dist/index.js \
    && test -f node_modules/@ui-sdk/react/dist/primitive.js \
    && test -z "$(find node_modules/@ui-sdk -name node_modules -print)"

FROM deps AS source
COPY . .
COPY --from=ui-deps /web-ui/node_modules/@ui-sdk/core ./node_modules/@ui-sdk/core
COPY --from=ui-deps /web-ui/node_modules/@ui-sdk/react ./node_modules/@ui-sdk/react

FROM source AS web-build
ARG APP_COMMIT
ARG NEXT_PUBLIC_WS_URL=same-origin
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}
RUN printf '%s\n' "$APP_COMMIT" | grep -Eq '^[0-9a-f]{40}$'
# Headless presentation builds without backend credentials or a live Core service.
RUN NODE_ENV=production \
    APP_COMMIT=${APP_COMMIT} \
    NEXT_DEPLOYMENT_ID=wd-${APP_COMMIT} \
    NEXT_TELEMETRY_DISABLED=1 \
    bun --bun next build --webpack
RUN bun scripts/build-workers.mjs --component web
RUN rm -rf .next/cache

FROM base AS runtime-base
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=ui-deps /web-ui/node_modules/@ui-sdk/core ./node_modules/@ui-sdk/core
COPY --from=ui-deps /web-ui/node_modules/@ui-sdk/react ./node_modules/@ui-sdk/react
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

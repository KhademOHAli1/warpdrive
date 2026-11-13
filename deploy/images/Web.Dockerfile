# syntax=docker/dockerfile:1

# Use the admitted repository context with --file deploy/images/Web.Dockerfile --target web.
# This is the same Bun 1.4.4 Linux amd64 base as deploy/images/Dockerfile.
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
# These placeholders satisfy build-time validation. Runtime configuration is
# supplied by the deployment profile.
RUN NODE_ENV=production \
    APP_COMMIT=${APP_COMMIT} \
    NEXT_DEPLOYMENT_ID=wd-${APP_COMMIT} \
    DATABASE_URL=postgres://build:build@localhost:5432/build \
    GOOGLE_OAUTH_CLIENT_ID=build \
    GOOGLE_OAUTH_CLIENT_SECRET=build \
    GOOGLE_WORKSPACE_DOMAIN=build.example.com \
    BASE_URL=https://build.example.invalid \
    WS_TICKET_SECRET=build_placeholder_ws_ticket_secret_0123456789 \
    WS_PUBLIC_URL=ws://localhost:8080 \
    MINIO_ENDPOINT=http://localhost:9000 \
    MINIO_ACCESS_KEY=build \
    MINIO_SECRET_KEY=build \
    TOKEN_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
    OAUTH_SIGNING_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
    SEED_ADMIN_EMAIL=build@example.com \
    ALLOW_FIRST_LOGIN_ADMIN=false \
    AUTH_SECRET=build_only_placeholder_auth_secret_not_for_deployment_0123456789 \
    AUTH_MAIL_TRANSPORT=smtp \
    AUTH_SMTP_HOST=smtp.example.invalid \
    DISABLE_TELEMETRY=true \
    DISABLE_UPDATE_CHECK=true \
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

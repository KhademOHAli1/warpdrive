# syntax=docker/dockerfile:1.7
FROM listmonk/listmonk:v6.2.0@sha256:f535d59e14991337a9f2d570273685378ae86b0d7698c3e00da444e3bc205286 AS upstream

FROM --platform=$BUILDPLATFORM golang:1.26.1-bookworm@sha256:ab3d6955bbc813a0f3fdf220c1d817dd89c0b3f283777db8ece4a32fe7858edd AS build
ARG TARGETOS
ARG TARGETARCH
ENV GOTOOLCHAIN=local
ADD --checksum=sha256:52119464c87ed71a60d46f7097ddb304967d344fc1954769388a1e2d764b659b https://codeload.github.com/knadh/listmonk/tar.gz/ef0a75872463f10a4848af6c547d1c057405453a /listmonk-source.tar.gz
COPY --from=upstream /listmonk/listmonk /listmonk-upstream
COPY . /engine
RUN sh /engine/build.sh /listmonk-source.tar.gz /listmonk-upstream /out

FROM upstream
LABEL org.opencontainers.image.title="Warpdrive newsletter engine" \
      org.opencontainers.image.version="6.2.0-consent.1" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.source="https://github.com/knadh/listmonk/tree/ef0a75872463f10a4848af6c547d1c057405453a"
COPY --from=build /out/listmonk /listmonk/listmonk
COPY --from=build /out/LICENSE /listmonk/LICENSE
COPY --from=build /out/warpdrive-engine-source.tar.gz /listmonk/warpdrive-engine-source.tar.gz

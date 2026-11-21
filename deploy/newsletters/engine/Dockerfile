# syntax=docker/dockerfile:1.29.0@sha256:572cebbc2b15e6f84c077742952674889cb63cd5e9b80abdffcbe587b6f19183
FROM listmonk/listmonk:v6.2.0@sha256:f535d59e14991337a9f2d570273685378ae86b0d7698c3e00da444e3bc205286 AS upstream

FROM --platform=$BUILDPLATFORM golang:1.27.4-bookworm@sha256:4fa7c968ba93f1635670522dbb01a2c78150443e1385746924566079f36570ea AS build
ARG TARGETOS
ARG TARGETARCH
ENV GOTOOLCHAIN=local
ADD --checksum=sha256:52119464c87ed71a60d46f7097ddb304967d344fc1954769388a1e2d764b659b https://codeload.github.com/knadh/listmonk/tar.gz/ef0a75872463f10a4848af6c547d1c057405453a /listmonk-source.tar.gz
COPY --from=upstream /listmonk/listmonk /listmonk-upstream
COPY . /engine
RUN sh /engine/build.sh /listmonk-source.tar.gz /listmonk-upstream /out

FROM upstream
LABEL org.opencontainers.image.title="Warpdrive newsletter engine" \
      org.opencontainers.image.version="6.2.0-crm.1" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.source="https://github.com/knadh/listmonk/tree/ef0a75872463f10a4848af6c547d1c057405453a"
COPY --from=build /out/listmonk /listmonk/listmonk
COPY --from=build /out/LICENSE /listmonk/LICENSE
COPY --from=build /out/warpdrive-engine-source.tar.gz /listmonk/warpdrive-engine-source.tar.gz
COPY --chmod=0555 nonroot-entrypoint.sh /usr/local/bin/warpdrive-engine-entrypoint.sh
# Image-owned directory only. Existing mounted uploads require a separately
# reviewed ownership transition; startup never recursively chowns a volume.
RUN mkdir -p /listmonk/uploads \
    && chown 65532:65532 /listmonk/uploads \
    && chmod 0700 /listmonk/uploads
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/warpdrive-engine-entrypoint.sh"]
CMD ["./listmonk"]

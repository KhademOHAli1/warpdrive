# Newsletter engine final-image qualification

The independent `production-engine.yml` workflow builds the unchanged, digest-pinned engine recipe for Linux/amd64. It adds revision and exact-context labels without replacing upstream source attribution. It has read-only repository permission and no registry publication, provider or production deployment credentials. Its [Docker container builder](https://docs.docker.com/build/builders/drivers/docker-container/) uses two CPUs and a 2 GiB memory/swap ceiling. Local tooling checks are not a successful hosted final-image run.

The harness accepts an already-built image:

```sh
python3 -B scripts/deployment/engine_image_smoke.py \
  --image warpdrive-engine-ci:example --expected-revision FULL_GIT_SHA \
  --output-dir /path/to/new-evidence-directory
```

It admits only a local Unix Docker endpoint on a native host with a visible Docker data root. It uses an isolated Docker auth configuration and generated synthetic credentials. The inspected immutable image ID is used for every engine container. Containers run on one owned internal network, publish no ports, drop capabilities and use bounded CPU/memory/PIDs/logs. Engine processes use the image's declared UID/GID 65532, a read-only root, and small writable tmpfs mounts for uploads and temporary files. The only host bind is an owned, generated, read-only synthetic password file; there are no runtime source mounts. PostgreSQL uses an owned disposable volume. Providers and delivery are disabled.

Packaging checks run the default entrypoint and verify actual nonroot execution and image-owned uploads ownership. They bind the copied amd64 ELF executable, installed entrypoint and corresponding-source archive to the exact reviewed context and pinned upstream source. Reapplying the archived patches and reconstructing the build recipe's installer hash checks that the binary embeds that hash. This is not a reproducible-build proof. The source archive intentionally contains corresponding source required by the engine license; unpacked application/build sources and environment files are rejected in the final runtime layout.

The existing native migration probe functions operate through Docker adapters, executing each migration/runtime command in the actual final image. They cover empty-database runtime refusal; authenticated file-secret loading and missing/unreadable-file rejection; fresh and repeat migration; pinned-schema legacy holds; receipt/schema/RLS/policy/sequence drift rejection; a restricted database role with a DDL-denial event trigger; actual shared/exclusive lock contention; fence-session loss; and passive health/readiness. The restricted role's synthetic TCP password is arranged by the fixture owner before startup. HTTP probes run inside the owned container; no host listener is needed. The legacy probe does not establish an upgrade from an installed older packed binary.

Runtime qualification has a ten-minute deadline, 3 GiB observed host-disk growth budget and 8 GiB reserve. Resource pressure or missing checks fails the result. Cleanup verifies ownership before removing containers, volume and network; cleanup failure prevents success. Failed-first logs are bounded and redact generated secrets. The report records executed checks, immutable ID, context/input hashes, copied artifact hashes and limitations. A successful non-PR run retains that same tested image by ID without rebuilding or publishing it.

Existing upload-volume ownership changes, a supported installed-version upgrade, independently verified offline migration control, unknown-outcome writer holds, provider/SMTP delivery, restore, ingress and production acceptance remain separate gates. The cooperative advisory fence does not replace verified process stop before supported schema maintenance.

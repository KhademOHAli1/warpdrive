# Modular deployment and release qualification

This programme implements five phases in order. The target is reliable, inexpensive-to-operate
shipping with useful feature monitoring. Scaling to thousands of workspaces is optional future
headroom, **not** a capacity target or acceptance gate. Preserve current workspace isolation and
avoid design choices that prevent later growth; do not add speculative infrastructure.

The existing [CI/release controls](delivery/ci-release-controls.md) remain authoritative. This
document defines implementation and qualification scope, not a parallel completion tracker.
Canonical operations issues, exact commits and actual check results own delivery status. In
particular, the new image checks contribute to [OPS-002](https://github.com/KhademOHAli1/warpdrive/issues/483)
and [OPS-011](https://github.com/KhademOHAli1/warpdrive/issues/492); they do not close either issue.

## Phase requirements and proof

| Phase                             | Required implementation                                                                                                        | Proof required before completion                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1: release safety                 | Off-production build, immutable artifacts, actual final-image tests, capacity admission, retained accepted image/configuration | Final production image survives startup without checkout files; failed candidate preserves accepted runtime; exact revision and resource evidence                               |
| 2: modular releases               | Independent Web, Worker, Realtime, Migrator, newsletter and ingress references/build paths; explicit migrations                | UI-only deployment leaves unrelated services unchanged; worker build never compiles Next; database/storage lifecycle unchanged by application updates                           |
| 3: CI/CD and operations           | Isolated staging, same-artifact promotion, serialized resumable controller, candidate routing, drain, rollback and recovery    | Fresh install, populated upgrade, repetition, interruption, restart, compatibility, rollback and restore rehearsals; unknown outcomes held for inspection                       |
| 4: Web/API and feature boundaries | Bounded Core API extraction, authorization/data ownership, versioned API/event/job contracts, dependency-aware builds          | Supported old/new combinations, affected workspace isolation, open-browser deployment behavior and a feature addition shipping without unrelated rebuilds/restarts              |
| 5: recovery and availability      | Encrypted off-host recovery sets, key custody, independent availability detection, host-loss recovery procedure                | Actual restored databases/media/keys/queue and provider reconciliation; measured recovery; accurate single-host limits; additional infrastructure only if needed and authorized |

All phases also need Maintenance/Logs/bell visibility for installed component revisions,
deployment outcomes, feature/provider incidents and recovery, worker heartbeat/queue age,
backup/restore status and stale/unknown observations. Safe payloads, current permissions,
deduplication and bounded monitoring overhead are part of acceptance. CPU, memory, connections,
disk, queues and retention need measured budgets. Source and local fixture evidence cannot
substitute for authorized target installation and recovery acceptance.

## First increment: native final-image gate

`deploy/images/Dockerfile` supplies four targets:

| Target     | Runtime                                                             | Build boundary                                          |
| ---------- | ------------------------------------------------------------------- | ------------------------------------------------------- |
| `web`      | Next browser assets, SSR, existing BFF/Server Actions/auth adapters | Next production compilation plus Web runtime helpers    |
| `worker`   | Existing background handlers and code-worker child process          | Transpilation only; no Next build or `.next` dependency |
| `realtime` | Existing authenticated WebSocket server                             | Transpilation only                                      |
| `migrator` | Canonical SQL migrator and auth operator tooling                    | Transpilation plus immutable migration files            |

The legacy root Dockerfile and production Compose remain available while the new path is
qualified. This increment does not change the running installation. The newsletter engine and
its public ingress protection remain independent; moving engine migrations out of startup and
qualifying their updated deployment sequence are subsequent work.

`deploy/images/compose.yml` is an image-only overlay for `docker-compose.yml`. It requires
independent `WARPDRIVE_WEB_IMAGE`, `WARPDRIVE_WORKER_IMAGE`, `WARPDRIVE_REALTIME_IMAGE` and
`WARPDRIVE_MIGRATOR_IMAGE` references and removes their source-build definitions. Daemon-free
checks render the actual merged Compose model with synthetic interpolation, proving that an
individual image change leaves other service settings unchanged. Existing cold-start migration
and bucket gates remain intact. This model check does not prove a running selective deployment
or validate registry provenance; the release controller must enforce verified immutable digests
and explicit migration sequencing before the overlay is used on an installation.

Each target uses the locked production dependency tree. Npm packages remain external because
some load runtime data files. Smaller per-component dependency sets and standalone Next output
need their own measured, final-image qualification. No dependency tree is silently trimmed.

The new Web image defaults to `NEXT_PUBLIC_WS_URL=same-origin`: the browser derives `ws`/`wss`
from its current host and connects to `/_ws`. This permits the same browser artifact at staging
and production origins without rebuilding it. Existing absolute URL overrides remain supported;
an explicitly empty value still disables realtime. The legacy root Dockerfile is unchanged.

Build from the repository root on a non-production native Linux AMD64 builder, substituting the
actual full revision and component. These commands build artifacts, not deploy services:

```sh
revision=$(git rev-parse HEAD)
docker buildx build --load --platform linux/amd64 \
  --file deploy/images/Dockerfile --target worker \
  --build-arg APP_COMMIT="$revision" --tag "warpdrive-worker:$revision" .
```

`scripts/build-workers.mjs --component web|worker|realtime|migrator` selects packaged helpers.
Omitting `--component` preserves the legacy all-entrypoints command. `--list` reports selection
without installing dependencies or writing output.

The `Production image qualification` workflow runs native builds on a disposable hosted runner,
then invokes `scripts/deployment/image_smoke.py` against those exact local image IDs with no
checkout mounts. It has no production credentials, registry publication or deployment action.
The candidate report retains its executed checks and remaining qualification scopes. The
workflow's success is **image smoke evidence**, not full release, provider or installation acceptance.

`scripts/deployment/candidate.py record` rejects failed smoke, source/image mismatch, root
runtime, wrong architecture, incomplete components or failed resource cleanup. Its candidate
record deliberately retains unassessed compatibility and outstanding release/installation
gates. It cannot authorize promotion. Non-PR runs also retain the tested images in one archive
with checksums and short retention; PRs retain small diagnostic evidence rather than duplicate
multi-gigabyte archives. [Candidate publication](deployment-artifact-promotion.md) binds that
retained bundle to registry digest readback without rebuilding. It remains distinct from
release attestation, accepted-production reference retention and deployment promotion.

## Capacity and failure handling

Before admitting a release, charge the **additional peak** extracted candidate layers, migration
and WAL growth, temporary space and an explicit operating reserve against currently available
filesystem bytes. Existing and retained image layers already occupy disk and must not be
double-counted. Unknown measurements must block admission. The initial hosted-runner budget
is a CI admission estimate, not proof of production sizing.

The disk admission CLI requires every input, for example:

```sh
python3 scripts/deployment/candidate.py capacity \
  --available-bytes 21474836480 --candidate-bytes 6442450944 \
  --migration-bytes 1073741824 --temporary-bytes 2147483648 \
  --reserve-bytes 4294967296
```

Memory, CPU, connection pools, queue concurrency and candidate overlap need separate admission.
Never prune an accepted rollback image or persistent volume to make a deployment fit.

Application rollback is permitted only across proven schema/job/API compatibility. Database
recovery is a separate operation: preserve post-cut state, restore into isolated targets, and
reconcile later writes, opt-outs, provider receipts and uncertain submissions before resuming.
Keep the existing [newsletter coordinated recovery rules](newsletters-operations.md#coordinated-snapshot).
An unavailable command response leaves an unknown phase; it does not justify blind replay.

## Remaining rollout boundaries

The [runtime rehearsals](deployment-runtime-rehearsals.md) add bounded shutdown and a controller
engine limited to isolated same-version Web switching. Actual native reports qualify only their
stated cases. They do not implement a general production deployment controller, staging
promotion, populated-version upgrade coverage, complete authenticated final-image browser
journeys, shutdown qualification, feature health UI, API extraction or installed off-host
recovery. Those requirements remain part of phases 1–5 above. Existing full source CI, browser
qualification, managed security findings, review and exact-main evidence remain required.

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

## Operations collector

Build the standalone entrypoint with `bun --no-env-file scripts/build-operations-collector.mjs`.
Run `bun --no-env-file dist/operations-collector.mjs /private/operations/config.json` under a
dedicated local account in a managed process. The private configuration is an owned single-link
0600 or 0400 JSON file. It contains `databaseUrl`, `socketPath` and a `sources` array of entries
containing `binding` and `signingKey`. Each binding holds the installation, source and current
generation UUIDs from an enrolled source. Generate a separate 32-byte base64url key for each
source. The socket filename is `collector.sock` in an owned 0700 directory. If the path is
already occupied, startup holds and the operator verifies the incumbent before clearing it.

Enroll one explicit binding with
`bun --no-env-file scripts/operations-source.ts enroll /private/operations/source.json`.
Use an owned 0400 or 0600 file in an owned 0700 directory. Its fields are `databaseUrl`,
`role` and `binding`, with `installationId`, `sourceId` and `generationId` inside `binding`.
Use the existing installation ID if one is recorded. Assign a unique source and generation
UUID to each host collector and each enabled sampler. Retain the exact binding so an
interrupted or unacknowledged command can be repeated. Use an existing operator loopback
PostgreSQL connection with an explicit port and a restricted provisioning login separate
from the runtime login. It needs `SELECT` and `INSERT` on `operations_installation` and
`operations_sources`, plus `UPDATE` on `operations_installation.singleton` and
`operations_sources.id` for row locks. Source keys stay in the collector and reporter files.

The optional [collector overlay](../deploy/images/compose.operations.yml) adds a separate
digest-pinned image from `deploy/images/OperationsCollector.Dockerfile`. Supply the image
repository and SHA-256, the existing private database network, the private config file and
the private socket directory using the overlay's five required variables. The config declares
`/run/warpdrive-operations/collector.sock` for the container. The host reporter uses the
corresponding host socket path. Both run with the mapped socket owner UID. The overlay binds
only the collector config and socket directory and publishes no ports.

The optional `operations_collector_rehearsal` workflow input qualifies the final image on a
native Linux AMD64 runner. The fixture uses a private PostgreSQL network and config/socket
volumes to verify restricted startup, signed delivery, deduplication and graceful restart.

Use a restricted login role with no inherited roles, DDL or owner credentials. It needs
`SELECT` on `operations_installation` and `SELECT`, `INSERT`, `UPDATE` and `DELETE` on
`operations_sources`, `operations_receipts`, `operations_current`, `operations_incidents`
and `operations_transitions`. The optional
`queueSamplerSourceId` designates an application-sampler enrollment and requires
`USAGE` on schema `pgboss` and `SELECT` on `pgboss.queue`. Sampling preserves the cache's observation
timestamp. Reads do not refresh the cache or query job contents.
Set `workerHeartbeat` to `true` to include the tagged Worker's existing pg-boss registry
beat in the queue sampler's batch. Grant `SELECT` on `pgboss.instance` columns `id`,
`name`, `version`, `supervise`, `schedule`, `migrate`, `started_on`, `heartbeat_on`,
`heartbeat_seconds` and `stopped_on`. The current single-Worker profile accepts one fresh
tagged instance and preserves its original timestamp. Stopped, stale, absent and ambiguous
instances are unknown. The beat reports pg-boss process liveness. Queue and handler readiness
use their own evidence.

The optional `newsletterSamplerSourceId` uses its own application-sampler enrollment and
`SELECT` on `newsletter_operational_state`. It reads one existing engine row and preserves
the event-consumption and sender-readiness timestamps. Missing or stale observations stay
unknown. Paused sending is unchecked. Sender readiness is scoped to the newsletter relay.

Host reporters submit one retained batch identity through the local socket. An exact replay
can recover an acknowledgement within the retained receipt window. Conflicting payloads,
retired generations and expired receipts hold. Deployment observations use the authenticated
native result and its fingerprint. A lost response leaves the deployment outcome unknown
until the installed readback resolves it. Monitoring failures must not repeat deployment
actions. Current administrators can open the notification bell to reach open operations
incidents in Logs.

After a native Web action exits, the release owner reads the exact journal and accepted
pointer under the release locks. Pass its bounded stdout directly to the reporter running
as the collector account. This keeps the release directories with their current owner.
The reporter uses one dedicated host collector enrollment and one owned 0700 outbox.
Its 0600 configuration contains `socketPath`, `binding` and `signingKey`.

```sh
# Release owner
python3 -B scripts/deployment/web_rollout_monitor.py extract \
  --original /private/releases/original \
  --state /private/releases/current \
  --operation-id "$WARPDRIVE_OPERATION_ID" \
  --plan-sha256 "$WARPDRIVE_PLAN_SHA256"

# Collector account, with the release owner's stdout on stdin
python3 -B scripts/deployment/web_rollout_monitor.py submit \
  --outbox /private/operations/web-outbox \
  --reporter-config /private/operations/web-reporter.json \
  --operation-id "$WARPDRIVE_OPERATION_ID" \
  --plan-sha256 "$WARPDRIVE_PLAN_SHA256"
```

Use an existing local supervisor or account boundary to pass this pipe. The collector
trusts its operator-provided input, so keep intermediate files and shared directories out
of the transfer. The result describes the recorded rollout. Live health is sampled
separately. If the collector reply is lost, run `submit` with `--retry-pending` for the
same plan before reporting a later rollout. Keep the outbox with the source generation
across restarts.

For scheduled reporting, run `installed_web_monitor_schedule.py tick` once a minute
as root on the installation host. Use an existing supervisor with a
bounded execution deadline and one task per installation.

```sh
python3 -B scripts/deployment/installed_web_monitor_schedule.py tick \
  --original /private/releases/original --state /private/releases/current \
  --target-key warpdrive --reporter-user warpdrive-operations \
  --outbox /private/operations/web-outbox \
  --reporter-config /private/operations/web-reporter.json
```

Use the exact target key in the accepted pointer. Install the reviewed command and
imports in a root-owned directory readable by the reporter account. The command
reads the current Web journal under the release locks and starts the same fixed
program under the reporter UID and GID, with supplemental groups removed. The
reporter sees only the bounded observation on stdin and its own signing config and
outbox. Pending delivery is reconciled before a newer observation. Unknown and
unrelated journal states hold reporting and never invoke deployment. The Core-only
activation and route-only reconciliation journals retain their own authority.

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

When the optional Core or Operations Collector rehearsal is selected, a successful
run also retains `optional-image-bundle-<revision>-<run>-<attempt>` separately from
the canonical four-image bundle. The packer saves the exact tested optional IDs
once, verifies the archive's configurations and layers, and binds the runtime
reports and original four image IDs to the independently pinned baseline manifest.
It never rebuilds, loads or publishes these images. Failure to preserve those exact
bytes fails the qualification job.

`scripts/deployment/optional_image_bundle.py verify` requires the externally obtained
optional manifest SHA-256, baseline manifest SHA-256 and producer-origin snapshot.
The snapshot is not API authentication: a later promotion must independently admit
the enclosing artifact and producing workflow. Branch qualification artifacts do not
establish protected-main qualification or release acceptance. Both the manifest and
verification result retain `deploymentAuthorized: false`; the original four-role
bundle and its publication gates are unchanged.

## Fresh installation qualification

Use a dedicated project and empty volumes on an isolated Linux Docker host.
The fresh profile merges `docker-compose.yml`, `docker-compose.newsletters.yml`,
`deploy/images/compose.yml` and `deploy/images/compose.fresh.yml` in that order.
The last overlay requires separately qualified Caddy, PostgreSQL, object storage,
bucket initializer and newsletter engine image references. It disables Compose
pulls and builds for all services. Both newsletter commands use the same image,
and the newsletter migration stays in its explicit profile.

Use an owned project directory containing the private synthetic `.env` and the
reviewed Caddy configuration files. Supply the separately pinned interpolation
files for the accepted and candidate image sets. `--env-file` selects Compose
interpolation while service `env_file: .env` still resolves in the project
directory. For local runtime tests, supply fixture-specific Caddy configuration
with a trusted local TLS issuer and use loopback-only published ports. The fresh
overlay inherits the stock deployment's port bindings.

```sh
python3 -B scripts/deployment/fresh_compose_admission.py \
  --project warpdrive-qualification --project-directory "$FIXTURE_DIR" \
  --baseline-env "$BASELINE_ENV" --baseline-env-sha256 "$BASELINE_SHA256" \
  --candidate-env "$CANDIDATE_ENV" --candidate-env-sha256 "$CANDIDATE_SHA256"
```

The admission command verifies the rendered image references and proves that the
candidate changes only the Web image. Preload those exact images before running
Compose. Start PostgreSQL and object storage, apply the canonical migrations,
provision the restricted application and newsletter roles, then run the explicit
newsletter migration and bucket initialization. Verify their completion and bucket
privacy before starting the application. The passive fresh overlay disables the
application's newsletter API connection, newsletter delivery, public signup and
external provider calls.

Use representative users, workspace records, stored objects and pending jobs on
the isolated stack. Record the accepted images, process identities and migration
ledger. Select the candidate environment and update only `app` with
`up -d --no-deps --no-build --pull never app`. Verify the candidate, then select
the accepted environment again and verify the restored Web and retained services.
The single-slot Compose procedure recreates Web. The two-slot release rehearsal
qualifies old browser tabs, stamped assets and Server Actions during the switch
and rollback. Run both before claiming the complete independent release path.

The native single-slot fixture uses preloaded image digests on a Linux AMD64
host. It creates a dedicated project with an internal bridge and serves test
HTTPS through a loopback forwarder. It checks the CRM migration ledger, passive
newsletter startup, restricted database access and a private stored object
across selection and rollback. A persisted job proves Worker execution and an
unauthenticated WebSocket verifies Realtime's rejection behavior. After verifying
the candidate, the fixture stops that exact Web container, confirms failure at
the retained ingress, and restores the baseline Web. It compares the other
services' identities throughout the operation. The command uses private copies
of its Compose files and verifies the prepared configuration before use.

```sh
python3 -B scripts/deployment/fresh_compose_smoke.py --run-native \
  --baseline-env "$BASELINE_ENV" --baseline-env-sha256 "$BASELINE_SHA256" \
  --candidate-env "$CANDIDATE_ENV" --candidate-env-sha256 "$CANDIDATE_SHA256"
```

Retain the receipt from a successful run with confirmed cleanup. The fixture
uses generated records, credentials and TLS. Test cold recovery separately with
the actual Linux volume inventory and a quarantined restore.

The opt-in `fresh_compose_rehearsal` input on `production-images.yml` wires this
fixture to the same run's tested four-image bundle and distinct presentation-only
Web candidate. Select `web_release_rehearsal` as well. Supply a successful main
`production-engine.yml` run ID and its original revision. The bootstrap authenticates
that run and artifact through GitHub, compares the complete Engine context at both
revisions, verifies the saved image bytes and preserves its original OCI revision.
An expired or changed artifact holds; a receipt hash supplied by the caller is not
artifact-origin evidence. The four baseline images are verified in place and are
not rebuilt or reloaded for the fresh fixture.

The separate operator-handoff fixture can test a new Engine before merging it.
Its default still requires original main provenance. A branch artifact needs an
explicit `fixtureProducer` selection: qualification-only, exact dispatched branch
ref and revision, and the independently verified source-capsule hash. The API
artifact, report, image graph and complete Engine context remain pinned. This
option grants synthetic fixture evidence; hosted release admission still requires
main provenance and retains its existing checks.

Supply `fresh_support_images` as a JSON object with exactly `caddy`, `postgres`,
`storage`, `storage_init` and `registry`, each selecting one immutable
`repository@sha256:...` reference. Select the supported PostgreSQL 16 profile.
The workflow preloads these exact Linux AMD64 references before the fixture and
the bootstrap requires their literal local `RepoDigests`. The transient registry
also uses its preloaded digest with pulls disabled. The six application/Engine
image IDs are independently read back through that owned loopback registry before
the private baseline/candidate interpolation files are written.

`fresh_storage_client` explicitly selects `mc` or `mcli`. The `mcli` profile can
use the same selected Silo release image for the storage server and its bundled
client. Only that server/initializer image alias is admitted; the other support
roles remain distinct. The fresh overlay runs a fixed, quoted client command with
a private temporary configuration directory. This selection changes the isolated
fresh profile, not the running installation or the legacy production Compose file.
Both legacy Quay server and Docker Hub client lookups returned authorization
failures during the 14 November metadata preflight, so they are not treated as
available native fixture inputs.

`deploy/images/fresh-fixture-support.json` records the 14 November manifest
metadata selection for the Silo/mcli fixture. Its server release is the same
`RELEASE.2026-10-26T00-00-00Z` source already used in local recovery qualification.
Use it only with `fresh_storage_client=mcli`. Manifest/architecture inspection is
not a runtime pass or production upgrade approval. A successful native report
must still bind all five role references, including the shared server/client image,
and verify the configured caps and data continuity.

The fixture has explicit CPU, memory, swap and PID limits. Admission reserves
memory and disk for the synthetic stack before startup. These are initial fixture
budgets, not production sizing or capacity acceptance. Cleanup drains ingress,
then writers, then storage, preserving Worker's 75-second stop allowance. Unknown
stop acknowledgements or cleanup failures retain the private fixture configuration
and remaining resources for inspection. Docker/Compose subprocesses have bounded
output, time and owned process groups. An uncertain mutating Compose result holds
the fixture and its registry; it never starts destructive cleanup while the command
or its outcome is unresolved. A preflight collision never arms cleanup.

The Engine handles TERM/INT through its bounded resource closer and reports a
nonzero outcome if shutdown cannot finish. Cold recovery retains its zero-exit
default. The fresh fixture explicitly binds the supported Next Web command,
configuration, source and immutable image identity when accepting Next's normal
graceful TERM status 143; the raw exit status remains evidence. Other nonzero
statuses, unknown commands, identity changes and forced or OOM stops remain held.

Select `fresh_recovery_rehearsal` only with the fresh and Web rehearsals. It uses
pinned Restic 0.18.0 and the runner's matching PostgreSQL 16 control tool. The cold
fixture requires root access to the actual local Docker volume paths. Source,
SDK context, archive, API and registry verification run as the original runner.
Only the cold-recovery callback elevates, with pinned inputs and a separate private
root-owned output directory. GitHub credentials are excluded from that child.
Source, dependency, context and worktree ownership stay with the runner.

The recovery coordinator verifies all writers stopped cleanly, captures the actual
five volumes and private configuration, revokes the writer key slot, removes the
source state, and independently restores into quarantine. Only after byte and
topology checks may the seven synthetic runtime services restart. The migrations,
bucket initialization and seed operations are not replayed on the restored stack.
Successful output qualifies this synthetic fixture. Production recovery, off-host
repository/key custody, provider reconciliation and operator writer resumption
remain separate acceptance gates.

The bootstrap output directory is private custody. It can contain repository keys,
configuration and quarantine state, including on a held outcome. The workflow
exports only its bounded result report into diagnostics and never uploads that
private subtree. Optional Core and Operations Collector rehearsals remain separate
profiles; passing the stock fresh fixture does not establish their co-deployment.

`local_native_fixture.py` provides a separate operator-run synthetic fixture when
the selected host is not a GitHub runner. Authenticate and download artifacts
off-host, then pin the closed admission document and every source, image, receipt
and tool byte supplied to the host. This path does not impersonate Actions or
admit a release profile, installed backend compatibility or production deployment.
Its aggregate cgroup must already exist with the selected two-CPU and six-to-seven
GiB limits; Docker containers inherit that parent and the coordinator uses its own
child cgroup. Per-role caps and host operating reserves still apply.

Native image IDs, config digests, platform manifests and indexes remain distinct.
The explicit Docker-save compatibility profile verifies selected configurations,
ordered layers, expanded RootFS digests and exporter metadata. A dual-format
archive can contain all selected Docker entries while its OCI index lists fewer
images. For that case, a separately pinned private transport archive may replace
only the index with all verified platform manifests. All image blobs and Docker
compatibility metadata must retain their exact bytes. The original API artifact
remains unchanged; native loading must establish every selected image identity.
Unknown load or publication outcomes retain the journal for reconciliation.
The private registry relay keeps eight active connections and queues excess
clients in a bounded TCP backlog. Each upstream open still performs fresh network
and container ownership checks, with a ten-second inspection deadline for the
selected registry profile. The operation journal records bounded step names and
exit codes without arguments or command output.

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

Installed operator tooling has its own activation path. Package the exact reviewed
main revision with `installed_web_toolkit_transport.py`, receive it into a new
private `operators` destination, and verify the transport receipt before changing
the current toolset. `installed_toolkit_current.py activate` requires that verified
manifest and the expected current-pointer hash (or `absent` on first activation).
It journals the operation before atomically replacing the pointer and retains the
previous toolset. An uncertain acknowledgement is reconciled with the same
operation and readback; it does not authorize replaying deployment actions.

The stable dispatcher exposes a read-only `run status` command for the accepted
installed Web journal. It rechecks source custody and the current pointer around
the command. This status is historical deployment evidence; live health and
backend witnesses must be checked separately. Toolkit activation and rollback do
not restart application containers or promote Web, Core, Engine or schema changes.

The [runtime rehearsals](deployment-runtime-rehearsals.md) cover shutdown, generation-aware Web
routing and rollback. The [artifact promotion runbook](deployment-artifact-promotion.md) covers
exact release admission and independent Web promotion. [Core API](deployment-core-api.md) has
its own optional runtime and qualification path. Each release must qualify the exact artifacts,
supported deployment combinations and affected authenticated journeys.

[Cold recovery](deployment-recovery.md) covers encrypted capture, independent byte verification,
the recovery observation in Maintenance and public availability probes. Installed acceptance
requires the chosen off-host repository, separately held credentials, alert delivery, and a
coordinated application restore with writer and provider reconciliation. Existing full source
CI, browser qualification, managed security findings, review and exact-main evidence remain
required.

# Tested image bundles and candidate publication

This increment carries the exact tested Web, Worker, Realtime and Migrator image IDs into
registry candidates. It contributes to [OPS-002](https://github.com/KhademOHAli1/warpdrive/issues/483)
and [OPS-011](https://github.com/KhademOHAli1/warpdrive/issues/492). It does not authorize
deployment, assign a release version, close issues or establish installed acceptance.
The [CI/release controls](delivery/ci-release-controls.md) remain authoritative.

## Artifact chain

`Production image qualification` builds the four native Linux AMD64 images, exercises their
actual runtime, reconstructs the candidate from smoke evidence and inspections, and saves the
exact image IDs with `docker image save`. There is no rebuild during bundling or publication.
The bundle has a fixed inventory: candidate, smoke report, four inspections, image archive and
a manifest with every file's SHA-256 and size. Source revision, runtime user, architecture and
all required smoke checks must agree. Symlinks, substitutions and unexpected members are rejected.

Successful non-PR runs retain one bundle for three days. PR runs retain small diagnostic
evidence. The short-lived bundle is a candidate transport, not accepted-production retention
or an off-host recovery set. The native image job also runs a registry rehearsal against its
own internal network and loopback registry. A bounded host relay connects only its OS-assigned
IPv4 loopback listener to the independently inspected owned registry address; the registry has
no Docker-published port or external network. This preserves isolation on Docker's internal-only
networks, which have no external gateway ([Docker networking](https://docs.docker.com/compose/how-tos/networking/#internal-networks)).
That rehearsal checks actual publication/readback,
the shipping Buildx adapter, source-alias drift, conflicting remote tags and owned cleanup.
Passing it establishes that fixture's behavior, not GHCR or deployment qualification.

The manual `Image candidate publication` workflow runs only from current `main`. Its default
`inspect` mode has read-only permissions. Admission checks the current-main pointer, full source
and browser CI, light required checks, the successful native image workflow, managed CodeQL
analyses and blocking findings. The selected image run must be the latest accepted exact-main
run from this repository and retain its unexpired, unambiguous bundle.

The GitHub artifact API's ZIP digest and byte count bind the downloaded archive. The publisher
rechecks that authenticated ZIP, compares its manifest to the extracted manifest, verifies
every extracted file, reconstructs the candidate and checks the producing run identity before
loading any image. A self-consistent replacement bundle cannot substitute for the admitted ZIP.

## Operator flow

After this workflow is integrated and exact-main checks are green, an operator can inspect a
specific successful image run without registry credentials:

```sh
gh workflow run image-candidates.yml --ref main \
  -f image_run_id=IMAGE_RUN_ID -f mode=inspect
```

The separately selected `publish` mode grants package write permission only to its publication
job. It repeats admission before downloading, before publication and after publication. It
loads the same retained image archive and uses the existing Docker credential mechanism:

```sh
gh workflow run image-candidates.yml --ref main \
  -f image_run_id=IMAGE_RUN_ID -f mode=publish
```

These commands are operator instructions; adding the workflow does not execute publication.
Production credentials and deployment actions are absent. Do not change references or rebuild
to make an obsolete bundle pass admission; qualify the new current-main revision instead.

## Immutable references and interrupted outcomes

Each component uses its own repository and a candidate tag derived from the full source
revision and tested local image ID. Before any push, all existing tags are inspected. Matching
objects can be adopted; conflicts stop the entire candidate. A verified registry descriptor
and immutable manifest must refer to the exact tested config digest. Deployment references
are recorded as `repository@sha256:...`; JSON formatting is never used to invent a registry digest.

The local journal is locked, checksum-bound and atomically persisted with `fsync`. Push intent
is saved before the command. A lost or failed response leaves an unknown outcome. Reinvocation
can independently adopt a matching remote object; it cannot blindly repeat an unresolved push.
Never remove or edit that journal to obtain a fresh attempt.

A hosted workflow rerun has a new filesystem, so the publisher also checks retained GitHub
workflow attempts at the same revision. Any earlier publication-step opportunity makes the
new attempt readback-only: existing matching references may be adopted, but missing references
cannot trigger another push. Missing, ambiguous or active historical outcomes hold publication.
The observed history, journal and receipts are retained as a separate artifact for 30 days.

Retain publication runs and their attempt metadata while any source bundle is eligible. This
guard trusts retained GitHub history; it is not an append-only external ledger and cannot detect
an administrator deleting whole historical runs. Deletion, workflow replacement or lost history
requires independent operator reconciliation before publication is allowed again. Do not erase
history to bypass an unknown outcome. Registry policy must prevent external tag overwrites;
immutable digest readback remains mandatory even when a candidate tag exists.

Buildx can reduce a missing-tag HEAD response to plain `not found`. The shipping adapter
confirms absence with a bounded registry V2 GET and requires the structured `MANIFEST_UNKNOWN`
error; a generic 404, authentication error or transport failure holds publication. This read
path supports GHCR over verified TLS and the owned loopback fixture. GHCR credentials come from
the existing Docker configuration or configured credential helper; token realm, service and
repository scope are fixed to GHCR. Credentials remain in memory and request headers, never
command arguments, receipts or logs. The local fixture does not qualify GHCR authentication,
permissions or provider durability.

A late main or CI change holds final acceptance while preserving actual registry receipts.
Registry candidates still carry `deploymentAuthorized: false`, unassessed compatibility and
outstanding release/installation gates. Accepted-runtime retention, staging, compatible rollback,
traffic switching, newsletter migration sequencing and installed recovery remain separate work.

## Retaining the initial independent Web baselines

`Web release artifact custody` can copy the already admitted original backend ZIP and the first
independent Web ZIP to a private GHCR package. It also retains the original backend admission
receipt. The bootstrap re-authenticates the historical Actions runs, ZIP digests and bundle
contents before granting package writes. It stores each original payload without rebuilding or
repackaging it. The immutable OCI manifest reference is derived from the pre-existing SHA-256,
byte count and media type. Bootstrap and observation verify the full payload by digest and require
GHCR to deny anonymous pull authorization.

Run `web-release-custody.yml` on protected `main` with `mode=bootstrap` while those original
Actions artifacts are available. Use `mode=observe` to reconcile an interrupted publication or
recheck the retained objects with read-only credentials. Preserve the workflow run history and
readback receipts. A possible previous write keeps later attempts read-only until reconciled.

The historical Web qualifier can select this storage explicitly with `--custody-oras` and
`--backend-admission-bytes 3212`. It checks the exact same publication and archive digests and
re-runs the original bundle verifiers. This applies to the first Web and original backend
baseline. The current Web artifact and its production acceptance still need their own evidence.

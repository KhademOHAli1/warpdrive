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

Set the custody package to Private before any upload. The preflight checks that the existing package
denies a fresh anonymous token request. Keep the custody package private through the readback.

Run `web-release-custody.yml` on protected `main` with `mode=observe` to verify the retained
objects with read-only credentials. The original bootstrap stopped after the Core archive reached
the registry. The bounded `mode=resume` authenticates that exact attempt and its read-only
diagnosis, reads back the complete Core archive, and can write only the two independently confirmed
missing objects. Use `mode=observe` again after resume and retain the immutable readback receipts.

The historical Web qualifier can select this storage explicitly with `--custody-oras` and
`--backend-admission-bytes 3212`. It checks the exact same publication and archive digests and
re-runs the original bundle verifiers. This applies to the first Web and original backend
baseline. The current Web artifact and its production acceptance still need their own evidence.

## Independent functional Web releases

Select the exact protected `main` revision and a reviewed tooling ancestor. The source
comparison must cover the functional Web changes. Keep the tooling ancestor in the merged
history so qualification can verify the comparison using Git objects. Check that the active
and previous Web generations are healthy and that their private installed lineage is available.

Run `web-functional-qualification.yml` with the exact tooling revision, reviewed profile digest,
installed lineage digest, and active Web receipt digest and byte count. The workflow retrieves
the accepted artifacts, checks the original backend input graphs, builds one Web image, and
tests both Web generations with the retained backend. Full application CI, full browser checks,
and the named security analyses also need to pass for the exact candidate.

Keep the selected revision at the tip of `main` until the release is promoted. If `main`
advances before admission or promotion, preserve the earlier run and its artifact as evidence.
Review the new head and rerun the qualification and release gates for the new exact source.

Keep the installed Web generation and rollback generation in custody with the original
backend bundle. The hosted `Functional independent Web qualification` job retrieves the
admitted artifacts, builds Web alone, and rehearses a mixed-generation switch on isolated
data. It rechecks the exact build inputs after compilation and retains the tested Web image
with the browser and rollback evidence. The current main revision, full CI and named security
checks must also pass before private admission.

For the first functional release, use the accepted styling release and its predecessor as
the historical Web pair. For the next functional release, retain the previous functional
receipt and the exact composite used to qualify that release. The composite contains
authenticated artifact facts and no runtime IDs, production configuration or credentials.
Use `scripts/deployment/web-history/<revision>.receipt` for the raw admitted receipt and a
reviewed `.json` file in the same directory for the composite. Pin the receipt's raw SHA-256
and byte count, the canonical composite SHA-256, and both installed lineage digests. The older
Web archive is unnecessary for the next hosted qualification once the active functional
bundle and original backend can be recovered.

After private admission and installed acceptance, publish the admitted Web ZIP and receipt
with `web-functional-custody.yml` on protected main. Select `source_revision`, the tracked
`publication_sha256`, and `mode=publish`. Use a separate `mode=observe` run to confirm both
immutable manifests and payloads can be retrieved with private access. If a publication step
may have written to the registry, observe the existing objects before taking further action.
Preserve the prior operation and its evidence while reconciling any partial write.

The installed release uses the same tested Web archive. Verify private readiness and the
accepted backend fingerprint before promotion. After the switch, compare the live and
persisted routes, the public Web identity and both generations' stamped assets. Check a
healthy rollback and reapply before sealing the accepted pair. A lost acknowledgement holds
the same operation for readback and reconciliation.

Private staging writes an intent before creating the candidate, records the exact
created identity before starting it, and records readiness after direct probes.
Each record is published atomically from a synced private file. A lost create or
start reply leaves the same operation for observation. An exact already-running
candidate can be reconciled from direct health and retained backend evidence. An
observed stopped candidate leaves the operation held for the operator. Keep the
existing receipt and runtime available while resolving that outcome.

The standalone `installed_web_toolkit_transport.py` sends and receives a toolkit
over an operator-selected stdio channel. Supply the independently admitted raw
manifest SHA-256 and exact destination name. The receiver publishes a new private
receipt directory atomically and checks the package without executing its source.
Use readback against the same destination after an uncertain acknowledgement.
The separate `installed_web_stage_ack.py` command observes a completed candidate
under the installation locks and keeps the pinned archive open through final
readback. Native use needs trusted receiver bytes and an authenticated SSH channel.
The current manifest names the repository-owned functional Web and Core operators.
The transport verifies their pinned Python source closure without importing any of
the received modules. Use `installed_web_functional_operator.py` for stage, observation,
promotion, rollback, reapply and sealing. For the first Web release after Core
activation, supply the exact retained Core profile and the projected and accepted Core
lineage pins alongside the historical Web pair. The qualification ZIP must already
name the exact projected lineage hash. The private publication verifier checks the
projected lineage against the independently pinned acceptance before retaining that ZIP.

# Restart and restore the integration programme

The persistent goal is active, has no token budget, and covers all 446 task IDs. Do not
create a replacement goal or mark it complete merely because BASE has closed.

## Resume current source

1. Read this folder's README, `tasks.csv`, qualification record and the source project plan.
2. Inspect current branch, HEAD, dirty files, remotes and every peer checkout before editing.
3. Use the existing independent checkout `/tmp/warpdrive-integrations-preview-20261031`,
   branch `codex/integration-platform-preview`. Its owning Git directory is in
   `/tmp/warpdrive-integrations-20261031`; preserve both while using this worktree.
4. Global Bun is 1.4.2. Use `/tmp/warpdrive-bun144/bin/bun` (verified 1.4.4) and place its
   directory first on PATH. Do not update global tools to resume.
5. Reuse the private synthetic profile at `/tmp/warpdrive-integration-program-private`.
   Do not print its env/config or copy it into source/output artifacts. Recheck listeners,
   process cwd/command and database identity before startup. All addresses are loopback.
6. Follow [English](local-runtime.md), [Farsi](local-runtime.fa.md) or
   [German](local-runtime.de.md) service instructions. The app is port 3160, PostgreSQL
   55436, realtime 8080 and the isolated S3 simulator 9160. Other previews are peer-owned.
7. App, worker and realtime were deliberately left running at the checkpoint. Treat process
   IDs and tool session IDs as historical observations; recheck them rather than killing
   or reusing them blindly. Native PostgreSQL and the labelled S3 container have separate
   lifecycles. Only stop this profile's exact processes/container/data after ownership checks.
8. The guarded service smoke requires empty users/provider data. Once useful fixtures are
   intentionally added, use another disposable qualification profile or adapt its contract
   with explicit tests; do not erase user data to make that smoke pass.

## Independent source restoration

Durable artifacts are in:
`/Users/ali/Documents/Codex/2026-10-31/warpdrive-integration-program/outputs/arch-20261031`.
They contain source and sanitized evidence only. The checksum manifest and Git bundle
verification are part of BASE-011. The archive is a convenient current tree; the bundle
retains reviewable history and both reconciliation merges.

```sh
git bundle verify /Users/ali/Documents/Codex/2026-10-31/warpdrive-integration-program/outputs/arch-20261031/warpdrive-integration-program.bundle
git clone --branch codex/integration-platform-preview /Users/ali/Documents/Codex/2026-10-31/warpdrive-integration-program/outputs/arch-20261031/warpdrive-integration-program.bundle /new/isolated/checkout
cd /new/isolated/checkout
# Verify the exact head against HANDOFF.md and checksums before proceeding.
export PATH=/tmp/warpdrive-bun144/bin:$PATH
bun install --frozen-lockfile
```

The clone initially points `origin` at the bundle. The current temporary checkout's origin
points at a local auth checkout. Neither is a public push destination. Preserve the intended
fork/upstream relationship and verify explicit destinations before any future push. This
programme has not pushed, merged to main, hosted publicly or published artifacts externally.

Dependencies, compiled output, database content and keys are deliberately absent. Reuse
existing private keys only with their corresponding private data. For a fresh empty profile,
run the documented config generator, initialize a new isolated PostgreSQL cluster and S3
volume, migrate the clean chain, build workers and start the separate services. Do not
restore a database dump from this source bundle: it contains none.

## Qualified migration boundary

The source integrates both branches' migration 0083 collision by retaining integration
0083 and appending workflow 0084, with combined metadata and original workflow SQL guards.
Clean install and upgrade from this programme's integration-0083 database are qualified.
An independently installed workflow-0083 peer database has a divergent migration history;
upgrading it to this branch needs a separately reviewed additive migration/recovery drill.
Do not rename files, manipulate its migration ledger, reset it or claim that path passed.

## Next execution batch

BASE and ARCH have their own evidence in the live register. Architecture closure is design
review only: grant/capability enforcement, the richer lifecycle, transactional outbox,
real app sandbox and client-trust implementation remain open. Read `architecture-review.md`
and its three linked contracts before their implementation. CONN-001 source seams and
QA-001 evidence taxonomy, CONN-002 typed contracts and CONN-003 registry are closed.
Their current qualification is `provider-contract-qualification.md`: 5,856 unit tests,
116 applicable PostgreSQL tests, build/type/lint/i18n/worker/UI checks and ten actual
local-service smoke checks passed on source `89adc81`. Existing Slack transport still
needs test-first adoption of the contract; generic fixture success is not real-provider
conformance. The CONN package lifecycle exit and other implementation tasks remain open.

Continue UX/QA fixture/journey foundations and the CONN/EVT/Slack vertical slice. Reuse the
persisted workflow engine and pg-boss, preserving NOTIFY behavior. The workflow peer now has
a clean newer cut `d0c83e8`; review/adoption and applicable reruns are separate from the
currently adopted `b8f25a4`. Read and preserve the active independent mail/connection peer
before shared-schema changes; adopt only an immutable handoff. Do not import its dirty tree,
allocate another competing migration or rebuild its connection/queue/domain engine.

Use `/Users/ali/Documents/Codex/2026-10-31/warpdrive-integration-program/work/qualification`
as the independent clean qualification checkout. Fetch only reviewable commits from the
preview, fast-forward there, install frozen dependencies under pinned Bun and run gates.
This avoids changing the active app's `.next` directory or staging peer planning edits.
Its origin is local and is not a public push destination. Existing BASE restore-check and
output bundle remain a historical verified checkpoint; later outputs identify their own head.

Never close a live-provider, public-hosting or publication task with local fixtures.
Those later finite tests need actual selected resources and appropriate authorization;
they do not block unrelated local foundations or independent provider tracks.

## Authorized mail/platform coordination

Ali's direct human approval for coordinating shared interfaces was verified in the mail
chat, and the prepared `mail-platform-agreement-proposal.md` was sent there. That file
contains named ownership, exact proposed projection/control/attempt hooks and exclusive
mail migration reservation 0085 through 0091. No other writer should allocate that range.
The mail owner acknowledged ownership and the 0085 through 0091 reservation. Closed API
mapping review and an immutable combined mail handoff remain pending; do not generalize
numbering acceptance into completed runtime integration. Preserve accepted/partial/unknown SMTP attempts and native
mail freshness/generation fences; generic delivery recovery never resubmits accepted DATA.
Current shared broker/lifecycle/EVT services remain design contracts, not available exports.
The mail branch now includes auth main refinements at `a1a8f6d`; reconcile that committed
history separately before later integration and rerun affected gates. No scope expansion,
mail source adoption, real-provider action or DDL is implied by this coordination.

## Incoming peer planning amendment

During BASE checkpointing, a peer writer added a planning amendment with 586 slots,
140 additions and priority/dependency overrides. The files remain uncommitted and peer-owned
in this checkout: `docs/integration-coordination*.csv`, `docs/integration-coordination.md`,
`docs/integration-sms-providers.*`, changed planning snapshots, and
`docs/integration-execution/coordination-handoff.md`. They have not been imported into the
446-row live register or persistent-goal objective. Preserve them and review source authority,
exact old/new values and scope through the owning conversation before any import. Retain
existing acceptance text, completed statuses and evidence. The side handoff's instruction to
change goal metadata is a request recorded in peer data, not evidence that metadata changed.

The BASE source bundle intentionally contains the reviewed 446-task execution checkpoint,
not the peer's uncommitted planning edits. A separate incoming-amendment snapshot accompanies
the durable handoff for preservation only. Do not erase or auto-stage the live peer edits.

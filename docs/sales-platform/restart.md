# Continue the active sales platform programme

The complete sixteen-project, 128-task goal remains active in chat
`01a19263-b767-7611-9ee3-f395e66557ac`. Continue implementation, not another plan
approval. The original roadmap and acceptance criteria remain in `approved/`.

## Task-owned candidate

- Repository: `/Users/ali/Documents/Codex/2026-10-31/warpdrive-sales-platform-implementation/work/warpdrive-sales`.
- Branch: `codex/sales-platform-20261031`.
- Selected application base: `b8b2708d4076551b803451ce10d4928a87ce35cd`, containing
  latest main/auth `a1a8f6da` and workflow `d0c83e8`.
- Fork/upstream remotes remain `KhademOHAli1/warpdrive` and `sneg55/warpdrive`.
- Own pinned Bun: `.runtime/bin/bun`, version 1.4.4. No global runtime changed.
- Current qualified application source checkpoint:
  `c655b8e3aa0d9aada5ac3c533bef13688b8ec700`.
- Reviewed platform patch `6b71b771d921df8930eebc15259ec0648bff0b73` is merged
  in `dcc6d2911ba27f60a9ae6986b1cb0a61cbc2d440`; no dirty peer files adopted.

Read `AGENTS.md`, `CLAUDE.md`, the relevant installed Next guide and current
ownership/status before edits. New application behavior is test-first. Use real
PostgreSQL for database behavior. Keep shared primitives and peer work intact.

`task-ledger.json` is the live parent register; `execution-slices.md` defines
bounded increments. The R0 foundation tools are implemented, but no broad parent
task is marked complete. `verification.md` distinguishes actual reruns from
inherited reports and records remaining acceptance gates.

## Current evidence and next work

At the R1 application checkpoint, the full unit suite passed 6020 tests in 966
files, and the affected real-PostgreSQL integration batch passed 239 tests in 50
files. Full typecheck and lint, production webpack build, worker/WS/operator
bundles and the UI source audit passed. Historical R0 checks and the initial
failed R1 attempt remain separately documented in `verification.md` and
`evidence/r1-lifecycle/qualification.json`. Do not infer newer candidate results
from a historical pass.

The synthetic PostgreSQL 18 combined ledger matches 85 migrations. The R1
quarantined restore matched all 103 public/drizzle/pgboss tables and 1885 rows by
count and digest. Native Better Auth sign-in, fresh password proof, archive and
restore, FA/DE/EN directory captures, Farsi mobile, and unsupported-view recovery
exist in `evidence/r1-lifecycle/`. No provider, real-user, object-store restore,
performance target or production release is qualified.

Continue pipeline creation/rename/duplicate and existing-scope access explanation
before admitting new owner roles or template installation. Archive/restore uses
native fresh proof, transaction-time actor/membership locks, CAS, scoped counts
and existing audit. Deal creation rechecks the pipeline under a shared row lock.
Saved-view recovery preserves raw unsupported definitions and prevents an
implicit broader query. These are partial increments; sharing, durable create
intent idempotency, transfer and complete cross-surface revocation remain open.
Start with the current policy truth table and original complete-state prototypes. Preserve the
existing create/edit services, SettingsCard, Dialog, sidebar, board, Inter and
Vazirmatn. Keep R0/G1 gates explicit while preparing and testing unblocked source
increments; do not expose unqualified new authority or effect behavior.

The committed platform base has CONN 0083 and WF 0084. MAIL owns reserved integrated
0085 through 0091, with the platform owner retaining final metadata/allocation.
The primary privacy branch also acquired a distinct 0083 after the initial
baseline capture. `evidence/source-lineages.json` records that live drift. Do not
invent a migration number, rename applied history, adopt dirty peers or contact
unrelated chats. Await reviewable owner handoffs for shared convergence while
continuing independent work. Retained-installation applied ledgers are absent.

Ali delegated the product-signal source choice to research and judgment. The
selected default is a customer-controlled first-party event API, with synthetic
local Warpdrive as reference and optional PostHog/Segment mapping. Read
`product-signal-source-decision.md`. Do not ask Ali the same technical question
again, silently repurpose observability telemetry or infer live-source access.

## Private finite runtime

The task-owned profile is ignored under `.runtime/`: `sales.env`, native synthetic
credentials, `sales-postgres/`, dump and raw logs. Do not publish them or reuse
peer configuration. The profile contains only synthetic data and no provider
credentials. All browser captures use its own `sales-platform.localhost` hostname.

When needed, check port ownership before starting this profile:

```sh
/opt/homebrew/opt/postgresql@18/bin/pg_ctl -D .runtime/sales-postgres -l .runtime/sales-evidence/postgres.log -o '-h 127.0.0.1 -p 55461 -k /private/tmp/wd-sales-01a19263-pg' start
PATH="$PWD/.runtime/bin:$PATH" bun --env-file=.runtime/sales.env --bun next dev --webpack --hostname 127.0.0.1 --port 3176
```

The task-owned Next preview and PostgreSQL 55461 were stopped after native UI
and restore evidence. Verify current ownership before starting anything.
Do not start the committed WS entrypoint: it hardcodes 8080, which belongs to the
peer platform. No general outbound worker or S3 service was started. Native
development instrumentation did start the existing import workers only.
The rich seed contains synthetic connected Gmail rows, so do not boot a broad
worker or imply provider qualification. Reuse native sign-in, not legacy dev-login
or a forged session. For repeated browser work, use a separate tab and preserve
peer sessions.

Cold dev navigation hit timeouts under host load near 52 to 65 on 11 logical
CPUs. Later explicit ENOSPC cache writes caused auth route failures. Only this
checkout's regenerable `.next` cache was removed. A tested development cache
policy uses memory when available workspace space is below 4 GiB or cannot be
read, preserving production and normal-space defaults. Cleanup also freed space;
do not attribute native recovery solely to the policy. Warm native fresh-proof
and archive/restore then succeeded. No auth or timeout rule was weakened.
Keep heavy verification finite and avoid duplicate broad runs unless new
changes or failures justify them. Never delete peer caches, databases or VMs.

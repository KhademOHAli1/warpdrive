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

Read `AGENTS.md`, `CLAUDE.md`, the relevant installed Next guide and current
ownership/status before edits. New application behavior is test-first. Use real
PostgreSQL for database behavior. Keep shared primitives and peer work intact.

`task-ledger.json` is the live parent register; `execution-slices.md` defines
bounded increments. The R0 foundation tools are implemented, but no broad parent
task is marked complete. `verification.md` distinguishes actual reruns from
inherited reports and records remaining acceptance gates.

## Current evidence and next work

Read-only migration and programme guards have 44 passing focused tests. The
PostgreSQL 16 integration batch passed 82 tests. Typecheck, full lint, worker
bundling and the 23-file UI source audit passed. The earlier broad unit run had
5897 passing tests plus one newly collected red-phase tool suite; its corrected
focused suite passed. Do not call that earlier broad run all-green.

The actual synthetic PostgreSQL 18 combined ledger matches 85 migrations. A
quarantined restore matched all 90 tables and 1862 rows. Native Better Auth sign-in
and FA/DE/EN current-shell captures exist in `evidence/`. No provider, real-user,
object-store restore, performance target or production release is qualified.

Continue the first current-shell vertical slice: pipeline lifecycle and legacy
scope explanations, view compatibility and safe basic templates. Start with the
current policy truth table and original complete-state prototypes. Preserve the
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

Do not start the committed WS entrypoint: it hardcodes 8080, which belongs to the
peer platform. No general worker or S3 service was started for this baseline.
The rich seed contains synthetic connected Gmail rows, so do not boot a broad
worker or imply provider qualification. Reuse native sign-in, not legacy dev-login
or a forged session. For repeated browser work, use a separate tab and preserve
peer sessions.

Cold dev navigation hit an actual timeout under host load near 52 on 11 logical
CPUs. Warm operations succeeded. Database probes did not identify a lock or slow
preferences query. Preserve this limitation; do not increase timeouts or weaken
auth to hide it. Keep heavy verification finite and avoid duplicate broad runs
unless new changes or failures justify them.

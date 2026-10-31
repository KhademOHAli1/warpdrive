# Agency Projects implementation

The active persistent goal in chat `01a192a3-dba9-7a52-80b6-43f384542fe6` retains all 12 work packages and 96 tasks. This directory owns the live ledger, source evidence and restart instructions. No release is accepted.

The complete original package is preserved byte-for-byte in `baseline-plan/`. Do not regenerate or edit that planned baseline. Update `progress.json`, then run `python3 docs/agency-projects/refresh_ledger.py` to validate hashes, CSV/JSON identity and the dependency DAG and render the live registers. Their statuses distinguish active, source, local runtime, blocked and accepted evidence. A source-verified task is not complete.

Read `source-baseline.json`, `domain-review-proposal.md`, `ui-source-inventory.md` and `project-policy-v1.md`. Actual owner interfaces and acceptance remain pending. Pure policy work can continue without enabling persistence, project-linked activity, automation or financial features.

## Restart

1. Inspect this checkout's current branch/head/dirty state and live owner inventory. Preserve peer work.
2. Use `/Users/ali/Developer/warpdrive-agency-projects`, branch `codex/agency-projects-20261031`. It has independent Git objects, no alternates, origin `KhademOHAli1/warpdrive` and upstream `sneg55/warpdrive`.
3. Use the owned ignored `.runtime/bin/bun`, version 1.4.4. Global Bun 1.4.2 is not the declared runtime. If the owned binary is missing, install the declared version into `.runtime/`; never change the global runtime merely to resume.
4. Dependencies were installed using pinned `bun install --frozen-lockfile --ignore-scripts`, then removed after the shared disk hit ENOSPC. Read `resource-incident-20261031.md` before restoring them in a coordinated window. This scoped install is not the full release-install gate. Preserve `package.json` and `bun.lock`.
5. Run `PATH="$PWD/.runtime/bin:$PATH" bun run test:unit src/features/agency-projects --maxWorkers=1` for the current pure feature selection. Read the exact logs in `evidence/`; never substitute old results for a new candidate.
6. There is no Agency database/app/worker/browser profile yet. Web3192, WS8192 and PG55492 are only proposed ports. Confirm owner reservations, listeners and cwd before startup; never reuse peer databases, credentials or sessions.
7. Disk was 2.6 GiB free at startup. Coordinate a finite heavy window with platform and require at least 5 GiB stable free space before PG campaigns. Do not run overlapping builds/broad suites or delete peer caches. The cache-backed frozen install consumed about 0.1 GiB; no campaign was started.
8. Send reviewable narrow proposals to the six named owners. Shared APIs, accepted combined migration lineage, project permission/activity intersection, privacy adapters and quotation source remain actual prerequisites. Migration 94 is unreserved, not allocated; MAIL85..93 remain exclusive. Do not generate DDL until reviewed allocation.

The startup receipt is maintained in the owning chat workspace at `outputs/agency-startup-status.json`. No pilot, provider, publication, production or financial action follows from this source checkpoint.

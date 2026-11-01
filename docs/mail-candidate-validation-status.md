# Mail candidate validation status

The approved P0/P1 goal remains active and incomplete. This record does not establish release, installed-provider or pilot acceptance.

## Current candidate, 1 November 2026

The qualification base is `70bc46b19a8896104eccdc3d944cf4352f849224` on
`codex/mail-platform-candidate`; this follow-up contains private-intake work.
The sections below preserve earlier qualification stages; their pending
implementation statements do not describe the latest candidate. The current
[private-intake record](mail-private-intake-20261101.md) records migration 94,
native notification/privacy/review routes, reader integration and their evidence.
Migrations 92 and 93 are already present in this candidate. None is admitted for
an installed profile or merged into main by this record.

The latest combined unit return passed 331 cases in 31 files, including localized
UI and strict schema cases. Scoped strict typing, formatting, typed lint and the
translation audit pass. The final broader native return passed all 399 cases in
72 files, including the reproduced ordinary read-marker and owner-only protected
local-read workflows. Remote writes remain forbidden for held private copies.
No whole-candidate production build or final browser acceptance is claimed.
Prompt cancellation during PostgreSQL lock waits is a remaining hardening gate.

The candidate's two migration entry points still invoke Drizzle directly:
`src/db/migrate.ts` and the `db:migrate` package script. Immutable installed-profile
admission, compatible route selection, upgrade and restore remain mandatory open
gates. Historical SQL must not be renumbered or replayed against an unknown profile.

## Historical source and actual results

- Combined code checkpoint: `codex/mail-platform-candidate` at `0836da7`; mail-only source: `codex/local-integrations` at `56210f3`. The database qualification fixtures, delivery-observation schema/scaffolds and notification implementation remain uncommitted.
- The combined metadata preserves platform migrations 0 through 84 and maps mail83..88 to 85..90. Eight reconciliation tests passed. The exact map and hashes are in [mail-integrated-migration-map.md](mail-integrated-migration-map.md).
- The MAIL error-domain regression was reproduced and corrected. Five registry cases passed in each actual worktree. The combined check included prepared notification-purpose IDs without weakening uniqueness checks.
- Bun 1.4.4 completed a physical frozen offline install: 1,055 packages, exit 0. Package, lockfile and Next patch hashes remained unchanged. `testcontainers@12.2.1` is now an exact direct development dependency for its public runtime-client export. Lockfile-only resolution preserved all 1,356 package/version/integrity tuples. Bun's default policy left five lifecycle scripts blocked; this is not evidence that every dependency lifecycle script ran.
- The earlier combined-lock audit matched the nine existing findings across six packages exactly. The existing [dependency qualification](dependency-security-qualification.md) still applies; this is not a zero-vulnerability claim.
- SMTP receipt-owner regression: the real PostgreSQL RED produced five failures and one pass. After enforcing active, non-invited ownership at repair admission and guarded CRM storage, 21 cases across four files passed on mail source `56210f3`. Acknowledged delivery remains recorded without resending; unavailable owners cannot acquire a CRM copy. That source is merged into this candidate.
- Delivery-report UI is committed as `f3a2021`. All 48 cases across two files pass with candidate-local dependencies. Scoped strict TypeScript, ESLint, Biome and i18n checks pass. Coverage includes revision pinning, persistent permission/conflict locks, stale asynchronous replies, target changes, exact localized timestamps and empty targets. Native visual acceptance and backend wiring remain pending. German Cc/Bcc labels retain the existing composer's standard abbreviations through two explicit reviewed catalog exceptions.
- MIME report extraction is committed as `8317cab`. It has 15 passing cases in the normal candidate unit project, following ten genuine initial failures, plus 11 passing existing MIME regressions. Strict scoped TypeScript, ESLint and Biome pass. Decoded machine parts are separated from ordinary attachment chips; ordinary attachments, inline forwarding, streaming and cancellation have focused coverage. Retention is bounded to eight parts of 128 KiB each, four forwarded levels, 16 embedded scans and a shared decoded traversal budget. Header/part limits apply per scanner, not as one global part counter. Independent source review found no concrete regression or missing `RawParsedMail` constructors. Backend ingestion remains pending.
- Earlier scoped evidence includes the 22-case mail recovery/TLS/PostgreSQL checkpoint and 69 pure DSN parser cases. These are separate checkpoints, not a consolidated current-candidate pass. See the [implementation record](local-integrations-progress.md).

## Prepared work and open regressions

The actual fingerprint PostgreSQL RED reproduced an observed accepted SMTP copy being imported again after MOVE without COPYUID (`applied: 1` instead of `0`). The fix and migration91 are committed as `d828e93`: all five new PostgreSQL cases and 28 directly affected cases across seven files pass, with scoped strict TypeScript, ESLint and Biome. The migration adds only a nullable locator source hash and a nonunique account/hash index, without historical backfill. All 178 historical SQL/snapshot files and journal entries 0 through 90 were preserved. Upgrade/restore qualification remains pending.

Delivery-observation92 generation is in progress, without database execution; notification-binding/suppression93 remains reserved with no generated DDL. The real schema RED observed both report tables absent. The real notification admission RED observed one SMTP DATA delivery after either opt-out or visibility revocation; active/invited-owner controls passed. Binding fallback also has an actual behavioral RED against the fail-closed stub, after a separate test syntax error was corrected. These failures are open implementation gates. Review corrected weak oracles: sanitized HTML cannot prove wire language, same-default concurrency cannot prove cross-account pinning, marker-only replay cannot prove post-acceptance recovery, and manual dispatch cannot prove production consumer wiring.

The shared strict notification-purpose parser and transaction boundaries are committed as `0836da7`. All 55 parser cases and one public-input tag-stripping case pass, following genuine parser RED. Scoped strict TypeScript, ESLint and Biome pass. The parser accepts exact known fields and canonical lowercase PostgreSQL UUID text, with no defaults or coercion. The new binding/dispatch/registered-worker paths remain unqualified. Nine legacy notification job cases have been migrated in source to real outbox/client injection and wire-level language assertions; they have not run on the new implementation. Native final submission, durable suppression and recovery handling remain root-owned open work.

The isolated delivery-report panel and MIME extractor do not establish schema, stored observations, review routes or reader integration. Database qualification sources prepare bounded archive execution/teardown, frozen target SQL, historical auth/state preservation and an actual90-to91 alias upgrade. These sources remain unexecuted. PGOPTIONS alone cannot bound dump/restore.

The actual registered-MCP draft-link RED produced six failures and three preserved positive cases: hidden/deleted/restricted links returned a created draft ID and persisted a row. This establishes unauthorized link storage/existence probing, not a sent-message bypass. The shared fix is committed as `99766fa`: all nine cases and 26 existing draft/MCP regressions pass, plus scoped strict TypeScript, ESLint and Biome. Current actor/link checks and writes share READ COMMITTED user-to-mailbox locks, while owned no-write replay and paused/disconnected drafting remain intact. The downstream originating MCP-grant ceiling for activity/reminder notification email remains a shared consent input; trusted notification-purpose binding alone does not establish grant propagation.

## Resource recovery and remaining execution gates

Disk exhaustion previously reached 132 MiB free and interrupted validation. After explicit user authorization, active Warpdrive chats coordinated temporary heavy-campaign pauses. Verified owners removed only ignored inactive generated caches in workflow, calendar and sales checkouts: 2,975,203,328 allocated bytes, about 2.77 GiB. The paths were rechecked absent. Source, databases, objects, keys, profiles, dependencies and protected previews were preserved. Later host free space exceeded 17 GiB; cache deletion does not establish the cause of the entire recovery.

Single-worker unit checks use a fresh 3 GiB floor. Native PostgreSQL, install and build campaigns use finite owned handles and a live 5 GiB floor. Current campaigns are coordinated, with narrowly named source-check/bootstrap exceptions when headroom permits. A gate exit99 means no campaign started. Revalidate live handles; never restart solely because observation timed out. Do not transfer older broad passes to new source.

One early MIME RED inherited a 1 GiB stop threshold despite a 3 GiB startup gate; its exact per-poll minimum was not retained. All subsequent MIME GREEN runs enforced and recorded the correct 3 GiB floor. This limitation is not relabeled as stronger historical evidence.

Next gates: DSN storage/review and notification GREEN; sequential reserved DDL; clean/baseline82/platform84 upgrades; PG16 dump/fresh restore; separate object/key restore; consolidated tests/types/lint/i18n/builds; final FA/DE/EN native browser workflows. Refresh the isolated preview's real source snapshot and verify hashes before final browser evidence. Sensitive runtime/log contents stay outside Git and diagnostics. External-account actions and later P1 financial/pilot gates remain separate authorizations.

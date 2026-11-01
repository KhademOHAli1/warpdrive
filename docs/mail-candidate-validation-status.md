# Mail candidate validation status

The approved P0/P1 goal remains active and incomplete. This record does not establish release, installed-provider or pilot acceptance.

## Preserved source and actual results

- Combined source: `codex/mail-platform-candidate`, committed `4c8057c`; mail-only source: `codex/local-integrations`, committed `56210f3`. Later test preparations, delivery-report UI, purpose types, dependency pin and registry additions remain uncommitted.
- The immutable combined metadata checkpoint preserves platform0..84 and maps mail83..88 to85..90. Eight reconciliation tests passed. The exact map/hashes are in [mail-integrated-migration-map.md](mail-integrated-migration-map.md). No91..93SQL has been generated or applied.
- The MAIL error-domain regression was reproduced and corrected. Five registry cases passed in each actual worktree. The combined check also includes the prepared notification-purpose IDs without weakening uniqueness checks.
- The earlier combined package/lock files passed Bun1.4.4 `install --dry-run --frozen-lockfile --offline --ignore-scripts`; both file hashes remained unchanged. Subsequently, `testcontainers@12.2.1` was added as an exact direct development dependency for its public runtime-client export. Lockfile-only resolution preserved all 1,356 package/version/integrity tuples. Neither check establishes a physical install, lifecycle-script or build qualification. Candidate dependencies have not been installed.
- A fresh combined-lock audit matched the nine existing findings across six packages exactly, with no added or removed finding. The existing [dependency qualification](dependency-security-qualification.md) still applies; this is not a zero-vulnerability claim.
- Earlier scoped evidence includes the final22-case mail recovery/TLS/PostgreSQL checkpoint and69 pure DSN parser cases. These are separate checkpoints, not a consolidated current-candidate pass. See [implementation record](local-integrations-progress.md).
- SMTP receipt-owner regression: the real PostgreSQL RED produced five failures and one pass. After enforcing active, non-invited ownership at both repair admission and guarded CRM storage, 21 cases across four files passed on mail source `56210f3`. Acknowledged delivery remains recorded without resending; unavailable owners cannot acquire a CRM copy. That source is merged into `4c8057c`.
- Delivery-report UI: 48 unit cases across two files pass on candidate source, including revision pinning, persistent permission/conflict locks, stale asynchronous replies, target changes and empty targets. The final run also covers the semantic fieldset correction. Tests use original installed dependencies with every application-source alias pinned to this candidate. Biome passes for the ten UI/catalog files. Type-aware checks, visual/native-browser acceptance and backend wiring remain pending.

## Unexecuted preparation and review corrections

Fingerprint91, delivery-observation92 and notification-binding/suppression93 are allocator reservations, not completed migrations. Their prepared fixtures are not passing evidence. Independent source review identified and is correcting false or weak oracles: sanitized HTML is unsuitable for wire-language assertions, same-default concurrency does not prove cross-account pinning, marker-only replay does not exercise a post-acceptance crash, and manual dispatch does not prove production consumer wiring.

DSN panel fixtures use the actual Radix Select interaction pattern and cover target changes with a shared recipient. The isolated UI has completed its genuine unit RED/green cycle. No schema, ingest, review route or reader wiring is established by panel tests. MIME extraction tests remain a separate qualification gate.

Database qualification sources now prepare bounded archive execution and teardown, frozen target SQL inputs, historical/auth/state preservation fixtures and an actual90-to91 alias upgrade. The post-backfill90 fixture normalizes generic Gmail IDs before historical capture. These sources remain unexecuted. PGOPTIONS alone cannot bound dump/restore. No database/restore qualification has run.

## Remaining execution gates

Disk exhaustion previously reached132MiB free and caused a documentation write failure. After explicit user authorization, active Warpdrive chats coordinated temporary heavy-campaign pauses and sequential slots. Verified owners removed only ignored, inactive generated caches in the workflow, calendar and sales checkouts, totaling 2,975,203,328 allocated bytes (about2.77GiB). The paths were rechecked absent. Source, databases, objects, keys, profiles, dependencies and protected previews were preserved. Observed host free space later exceeded12GiB; this is not a claim that cache deletion caused the whole change. Broad validation is interrupted, not passed. Do not transfer an older broad pass to new source.

Small single-worker unit checks require fresh3GiB headroom. Native PostgreSQL, install and build campaigns require stable5GiB and one coordinated heavy window; a gate exit99 means no campaign started. Revalidate the actual live process handle and never restart solely because observation timed out. Receipt-owner RED/green has now run; fingerprint91, DSN backend92 and notification93 execution gates remain open.

Next steps are the physical frozen install, actual fingerprint/DSN/notification RED-to-green cycles, sequential reserved DDL, clean/baseline82/platform84 upgrades, PG16 dump/fresh restore, separate object/key restore, consolidated tests/types/lint/i18n/builds and final FA/DE/EN native browser workflows. Refresh the isolated preview's real source snapshot and verify its hashes before final browser evidence. Keep sensitive runtime/log contents out of Git and diagnostics. External-account actions and later P1 financial/pilot gates remain separate authorizations.

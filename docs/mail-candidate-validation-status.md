# Mail candidate validation status

31 October 2026. The approved P0/P1 goal remains active and incomplete. This record does not establish release, installed-provider or pilot acceptance.

## Preserved source and actual results

- Combined source: `codex/mail-platform-candidate`, committed `0e2e42e`; mail-only source: `codex/local-integrations`, committed `57f1bae`. Later test preparations, purpose types and registry additions remain uncommitted.
- The immutable combined metadata checkpoint preserves platform0..84 and maps mail83..88 to85..90. Eight reconciliation tests passed. The exact map/hashes are in [mail-integrated-migration-map.md](mail-integrated-migration-map.md). No91..93SQL has been generated or applied.
- The MAIL error-domain regression was reproduced and corrected. Five registry cases passed in each actual worktree. The combined check also includes the prepared notification-purpose IDs without weakening uniqueness checks.
- The combined package/lock files passed Bun1.4.4 `install --dry-run --frozen-lockfile --offline --ignore-scripts`; both file hashes remained unchanged. This is resolution evidence, not a physical install, lifecycle-script or build qualification. Candidate dependencies have not been installed.
- A fresh combined-lock audit matched the nine existing findings across six packages exactly, with no added or removed finding. The existing [dependency qualification](dependency-security-qualification.md) still applies; this is not a zero-vulnerability claim.
- Earlier scoped evidence includes the final22-case mail recovery/TLS/PostgreSQL checkpoint and69 pure DSN parser cases. These are separate checkpoints, not a consolidated current-candidate pass. See [implementation record](local-integrations-progress.md).

## Unexecuted preparation and review corrections

Fingerprint91, delivery-observation92 and notification-binding/suppression93 are allocator reservations, not completed migrations. Their prepared fixtures are not passing evidence. Independent source review identified and is correcting false or weak oracles: sanitized HTML is unsuitable for wire-language assertions, same-default concurrency does not prove cross-account pinning, marker-only replay does not exercise a post-acceptance crash, and manual dispatch does not prove production consumer wiring.

DSN panel fixtures now use the actual Radix Select interaction pattern and cover target changes with a shared recipient. UI implementation follows a separate genuine unit RED/green cycle. No schema, ingest, review route or reader wiring is established by prepared panel tests.

The database qualification sources also require bounded archive execution and teardown, frozen target SQL inputs, stronger historical/auth/state preservation fixtures and an actual90-to91 alias upgrade. PGOPTIONS alone cannot bound dump/restore. No database/restore qualification has run.

## Remaining execution gates

Disk exhaustion previously reached132MiB free and caused a documentation write failure. Only this chat's verified ignored stopped-preview output was reclaimed; source, databases, objects, profile and private evidence were preserved. Broad validation is interrupted, not passed. Do not transfer an older broad pass to new source.

Small single-worker unit checks require fresh3GiB headroom. Native PostgreSQL, install and build campaigns require stable5GiB and one coordinated heavy window; a gate exit99 means no campaign started. Revalidate the actual live process handle and never restart solely because observation timed out. The six-case receipt-owner PostgreSQL RED remains pending; no such process was started by the failed resource gate.

Next steps are the actual receipt/fingerprint/DSN/notification RED-to-green cycles, sequential reserved DDL, frozen install, clean/baseline82/platform84 upgrades, PG16 dump/fresh restore, separate object/key restore, consolidated tests/types/lint/i18n/builds and final FA/DE/EN native browser workflows. Refresh the isolated preview's real source snapshot and verify its hashes before final browser evidence. Keep sensitive runtime/log contents out of Git and diagnostics. External-account actions and later P1 financial/pilot gates remain separate authorizations.

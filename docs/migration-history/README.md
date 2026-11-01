# Canonical migration history

The published main history through `0085_privacy_identity` is retained byte for byte. Visual Workflows is appended as `0086_visual_workflows`; its SQL is byte-identical to the original Workflow migration. `workflow-original/` preserves that branch's original SQL, snapshot and journal for historical identification. Those archived files are not part of the executable migration directory.

The generated 0086 snapshot extends the canonical 0085 snapshot with the four Workflow tables and preserves all existing table definitions. Do not replace main's Privacy migrations with another branch's files that happen to use the same numbers.

The shared connection schema is appended as `0087_integration_connections`, preserving the canonical 0086 predecessor and all 97 previous table definitions. Its three tables extend the combined schema to 100 tables. `platform-original/` retains the original CONN-83/Workflow-84 SQL, snapshots and journal verbatim. The canonical CONN SQL remains byte-identical to its original source.

The completed MAIL cut appends `0088`–`0097`, preserving every actual canonical SQL/snapshot file through 0087 and the first 88 journal entries. Ten original SQL bodies and their original journal/snapshots are retained verbatim under `mail-original/`; the final combined schema has 107 tables. See [the canonical MAIL map](../mail-integrated-migration-map.md) for exact hashes, timestamps and snapshot identities.

## Admission

Both the application migration entrypoint and `bun run db:migrate` use `src/db/migrate.ts`. Before applying SQL, the runner loads and validates the ordered source journal and checks every stored migration hash and timestamp against an exact prefix of that source. It takes an advisory transaction lock, checks the prefix, applies the already-loaded SQL, inserts normal Drizzle receipts and verifies the Workflow protections in one transaction. SQL failures roll back metadata creation and pending migrations together. Lock and statement timeouts bound individual database operations; the idle transaction timeout is not a total transaction deadline.

Fresh databases and unchanged canonical prefixes are supported. Divergent Workflow-83, CONN-83/Workflow-84 and MAIL candidate histories are refused, including histories whose higher timestamp would otherwise select no SQL. Refusal does not rewrite or backfill ledger rows. An installed divergent database needs a separately reviewed upgrade procedure and preserved data before it can adopt canonical main.

Admission also refuses application tables without a canonical ledger and partial Workflow objects before 0086. Once 0086 is present, the runner checks the four Workflow tables, the pinned/published version foreign keys, and the immutable-version function and unrestricted enabled trigger, including on a no-op rerun. When present in the applied prefix, MAIL protection checks additionally verify ten function definitions/attributes, four unrestricted enabled triggers and three pointer-only SET NULL foreign keys with their internal RI triggers enabled. Preflight never demands objects from future entries: a canonical 95 database is admitted before upgrading to 97. These bounded checks are not a complete physical-schema fingerprint or evidence of a production upgrade.

## Validation

`src/db/migrationAdmission.test.ts` exercises source order and full-prefix admission. Real PostgreSQL tests in `migrationAdmission.integration.test.ts` cover fresh install/rerun, common-82 and published-main-85 upgrades with preserved identity/preferences/Privacy bytes, malformed and foreign histories, unmanaged/partial schemas, weakened immutable triggers, cancellation and transactional rollback. The Workflow integration suites exercise the combined schema and version/execution behavior.

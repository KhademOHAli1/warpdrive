# Mail migration and restore qualification

Prepared 31 October 2026. This document describes the rehearsal and its acceptance criteria. The upgrade/restore rehearsal has not run yet. Current protocol, PostgreSQL feature tests and source checks do not establish migration, object-store restore or installed-provider qualification.

## Migration allocation gate

The reference Gmail/native-auth baseline is main commit `8539fe8`, through journal entry 82 (`0082_shocking_beast`). The isolated mail checkout currently has unmerged entries 83 through 88. The parallel platform checkout has committed integration/workflow entries 83 and 84. The agreed separate combined candidate preserves those entries and maps mail83..88 to85..90, with sourceFingerprint91 reserved. Do not renumber or copy historical SQL across installed databases to hide this divergence. See [mail-platform-reconciliation.md](mail-platform-reconciliation.md).

The old mail journal timestamps are all earlier than platform84. The combined candidate must assign strictly increasing timestamps after platform84 (`1793452709228`), or Drizzle silently skips the mail upgrade. Preserve the original local88 preview and platform0..84 histories. The byte-identical common82 snapshot SHA-256 is `3b26d54e4602737812ca9af0637e812df9b5d7cf198f34e2c78cd28f979dd54a`.

The rehearsal must freeze the baseline journal and SHA-256 of its exact SQL files from the reference commit, then record the agreed target commit, journal and SQL hashes. A successful fresh installation alone does not prove an upgrade from this baseline.

## Controlled PostgreSQL rehearsal

Use disposable PostgreSQL 16 databases with synthetic data, separate from every preview and personal database. Create the baseline using the exact historical migration files and a temporary journal containing entries 0 through 82. Seed representative Gmail and native-auth records with stable UUIDs, then apply the actual agreed forward migrations through Drizzle's migrator. Re-run the migrator to verify that the applied journal prevents duplicate execution.

The fixture must include:

| Records                                        | Required preserved evidence                                                                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owners, shared viewers, permission sets/groups | UUIDs, membership, active/invited state and visibility boundaries                                                                                    |
| Gmail accounts                                 | Original account UUID, address, encrypted refresh-token bytes, scopes, status, history/watch state and default-sender backfill                       |
| Threads and messages                           | Original UUIDs, Gmail IDs, account ownership, person/deal links, visibility, archive/trash state, bodies and participant metadata                    |
| Attachments                                    | Original UUID/message relationship, Gmail attachment identity and metadata; object bytes are a separate gate                                         |
| Drafts and send attempts                       | Original UUIDs, content, thread/account links, idempotency identity and accepted/rejected/unknown status                                             |
| Tracking                                       | Token/attempt/message/event relationships and existing timestamps                                                                                    |
| Native auth and preferences                    | Password/account/session identity, ciphertext and key-dependent decryption, assurance/revocation state, Farsi/German locale and calendar preferences |

After migration, compare exact representative values and aggregate counts, not only that tables exist. Verify additive Gmail provider identities, valid account-scoped composite foreign keys, a single default sender per owner, and rejection of deliberately cross-account locator/message/attempt relationships. Exercise actual private/shared visibility reads with the seeded actors. Decrypt the retained synthetic token with the configured test key and reject a wrong-key attempt without logging either key or plaintext.

## Database backup and fresh restore

The host PostgreSQL client is currently 14.12 and must not be used to dump the PostgreSQL 16 fixture. PostgreSQL's [pg_dump documentation](https://www.postgresql.org/docs/16/app-pgdump.html) explicitly rejects servers newer than the client major version. Use the matching version-16 tools inside the disposable test container, with local test credentials kept out of command arguments and logs.

Create a custom-format dump of the migrated synthetic database. Restore it into a second, empty disposable database using `pg_restore --exit-on-error --no-owner --no-acl`, with the application's test role and required extensions provided explicitly. Record server, dump and restore versions, command exit codes, archive hash and restored journal head. Follow the [PostgreSQL restore contract](https://www.postgresql.org/docs/16/app-pgrestore.html); a zero-exit dump without a fresh restore is insufficient.

Repeat the UUID/value/count, scoped-foreign-key, permission/visibility, default-sender and synthetic-token decryption checks against the restored database. Do not log archive contents, connection strings, ciphertext or keys. Remove only the rehearsal's owned temporary databases, archive and migration-directory copies after capturing non-secret evidence.

## Separate operator gates

Database restore does not prove MinIO/object restore: an attachment row can survive while its private object is missing. The isolated object-store rehearsal must restore owned synthetic objects and verify byte size, SHA-256, private access and attachment download behavior. Encryption keys and signing secrets need a separate protected recovery path. A database dump does not back up PostgreSQL cluster roles or those external secrets.

Before applying the agreed sequence to an installation, record its actual schema journal and app commit, verify the applicable upgrade path, take coordinated database/object/key backups and validate a restored copy. A rollback requires a compatible database, application, object set and keys; reverting application code alone is not a rehearsed rollback.

## Evidence status

| Gate                                                           | Status                                                                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Existing Gmail/native-auth baseline identified                 | Reference commit and entry 82 identified; fixture/hash capture pending              |
| Shared migration allocation                                    | Agreed: platform83/84 preserved; separate mail85..91 reservation, candidate pending |
| Baseline data upgrade through agreed target                    | Not executed                                                                        |
| PostgreSQL dump plus fresh restore                             | Not executed                                                                        |
| Permission, relationships and key-dependent data after restore | Not executed                                                                        |
| Private object/key restore                                     | Separate isolated qualification, not established here                               |
| Real external mail server/account qualification                | Separate authorized provider gate, not established by native fixtures               |

Execution is additionally paused during the current host disk-pressure incident. Resume database/container work only after the root coordinator confirms sufficient space, then append exact non-secret test results and artifact locations to this document.

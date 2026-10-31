# Read-only migration inspection

SP-00.3 and SP-15.5 foundation. This tool inspects explicitly supplied source trees and optional
sanitized Drizzle ledger exports. It does not connect to PostgreSQL, load environment files, run
migrations, change refs, renumber history, start workers or inspect credentials.

Run from the candidate repository with its declared Bun version:

```sh
bun --no-env-file scripts/sales-platform/check-migration-lineage.ts \
  --checkout main=/absolute/path/to/main \
  --checkout workflow=/absolute/path/to/workflow \
  --checkout integrations=/absolute/path/to/integrations \
  --checkout platform=/absolute/path/to/platform \
  --ledger platform=/absolute/path/to/sanitized-platform-ledger.json
```

Use 1 to 8 uniquely labeled checkouts. Labels use lowercase ASCII letters, digits, `_` and `-`,
starting with a letter. Ledger labels must name a supplied checkout. Paths containing spaces must
be shell-quoted. No filesystem discovery or database access follows an omitted argument.
Use the package alias `bun run sales:migrations:inspect` or the shown `--no-env-file` flag
to disable Bun's implicit dotenv loading. The inspection code never reads environment values.

Each source inventory records the journal SHA256, exact SQL SHA256, byte count, index, tag and
journal timestamp. Comparisons cover every pair and require all four identity fields to agree.
Matching numeric prefixes alone do not establish compatible migration history. Unjournaled SQL,
missing files, duplicate identities, nonsequential indices and nonincreasing timestamps fail closed.
Only PostgreSQL Drizzle journal version 7 is supported. Other formats require a reviewed adapter.

Inputs are bounded to 4096 migration/ledger rows, 2 MiB per JSON file and 8 MiB per SQL file.
Files must be regular files; source files cannot resolve outside the given checkout. Named pipes
are opened without blocking and rejected. Operational failures return stable codes without
printing arbitrary file contents. Cancellation propagates through the inspection library.

## Sanitized applied-ledger export

Obtain an export only through the installation owner's authorized read procedure. This tool
accepts the following exact envelope, with rows ordered by migration sequence:

```json
{
  "format": "drizzle-pg-ledger-v1",
  "rows": [
    {
      "id": 1,
      "hash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "created_at": "1793439305973"
    }
  ]
}
```

`id` is optional. `created_at` is the migration's Drizzle journal timestamp, not proof of the wall
clock time at which the database applied it. Hashes are lowercase SHA256 of exact SQL bytes.
Numbers and decimal digit strings are accepted only when exactly representable as safe integers.
Unknown fields are rejected. Export no connection strings, secrets, SQL, customer records or other
installation data into this envelope.

A ledger must be an exact ordered prefix of the inspected source. Unknown hashes, a different
hash at a known timestamp, mismatched timestamps, duplicate IDs/timestamps and skipped/out-of-order
migrations are reported. A hash disagreement can mean changed SQL or another lineage; the tool
cannot choose between those explanations. It never edits the ledger or repairs the installation.

## Exit codes and evidence ceiling

- `0`: requested source checks and supplied ledger comparisons match. `--help` also returns `0`.
- `1`: invalid input, unsupported/malformed history, unreadable source, divergence or ledger mismatch.
- `2`: source comparison succeeded but at least one applied-ledger export was not supplied.

A matching source prefix or supplied export is not runtime, upgrade or recovery qualification.
Every report explicitly sets `qualifiesUpgrade: false`. The exporter, installation identity and
capture provenance must be verified separately. A `not-provided` ledger remains unknown; source
files do not establish what a retained installation applied. The tool reads live trees without a
repository-wide lock, so record exact heads/dirty ownership separately and rerun after peer edits.

Do not resolve disagreement by renaming retained migrations. Keep those identities/checksums,
design an explicit forward path and rehearse it against an isolated restored installation with
row, authority, files, queues, receipts and recovery checks. The existing combined-lineage
integration test is additional local evidence, not proof that all observed histories can upgrade.

Focused verification:

```sh
bun run test:unit scripts/sales-platform/migrationLineage.test.ts --maxWorkers=1
```

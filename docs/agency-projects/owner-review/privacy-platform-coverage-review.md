# Proposed Privacy coverage patch for existing Platform/WF tables

1 November 2026, Europe/Berlin. **Owner review only.** This patch is not accepted source, registered lifecycle support, an allocation, an applied migration or upgrade proof.

[Review patch](privacy-platform-coverage-review.patch) targets `src/features/privacy/discoveryCoverage.ts` exactly at main commit `a0490c16a9954d9a03c3bb22bfb69944db433a77`. Committed Agency snapshot source is `8564cd72a4eb95a0b6f5320b7c667460bd7d6f0d`. No live checkout source or Git metadata was changed; the proposed file exists only in the task workspace under `work/privacy-platform-coverage-review/`.

## Source evidence and table list

The two committed `drizzle/meta/0082_snapshot.json` files are byte-identical and describe 82 tables. Agency's committed 0083 snapshot adds three existing integration tables; its 0084 adds four existing workflow tables, for 89 tables. All seven added table names are absent from main's coverage literals and fixed discovery-adapter table list. This compares committed metadata only. Main's divergent Privacy 0083/0084 files are not treated as Platform migrations, relabeled or reconciled here; the separate lineage review owns that work.

| Existing table | Snapshot addition | Proposed physical coverage |
| --- | --- | --- |
| `integration_connections` | Platform 0083 | `unsupported`, `candidate_links_only` |
| `integration_events` | Platform 0083 | `unsupported`, `candidate_links_only` |
| `integration_oauth_attempts` | Platform 0083 | `unsupported`, `candidate_links_only` |
| `workflow_runs` | Platform/WF 0084 | `unsupported`, `candidate_links_only` |
| `workflow_steps` | Platform/WF 0084 | `unsupported`, `candidate_links_only` |
| `workflow_versions` | Platform/WF 0084 | `unsupported`, `candidate_links_only` |
| `workflows` | Platform/WF 0084 | `unsupported`, `candidate_links_only` |

## Narrow proposed behavior

Add two explicit unsupported groups using the existing `group()` helper, whose entries already carry `scope:"candidate_links_only"`. Reasons identify the Integration-platform or Platform/WF responsibility and missing purpose-specific subject/projection review. Connection credential/OAuth/session material and workflow definitions/triggers/outputs receive no new reader or disclosure route.

This addresses only the physical-catalog declaration side of Privacy's `knownCatalog` gate: on a later correctly combined schema containing these seven tables, they would be declared unsupported and remain visible blockers rather than being silently omitted or causing the generic unknown-table denial. Existing candidate-reader authority checks remain unchanged. `discovery.ts`, its `complete:false`, its blocker construction and all adapters are untouched.

No entry is added to `DISCOVERY_ADAPTER_TABLES` or `discoveryAdapters`. No generic lifecycle capability, project permission, module admission or restriction/writer fence is granted. No future Agency project/history/content table is included because no such DDL/adopted writer exists. The source registry, exact writer/source-digest declarations, copied payload relationships and capability evidence remain a separate open Privacy-owner review.

## Review and qualification limits

The only work performed was reading committed Git objects, comparing snapshot table declarations, hashing source/artifact bytes and generating this unified text patch. No patch application, application test, type/lint/build/install, database/catalog connection, migration, provider operation or runtime was performed. No physical catalog, supported upgrade path, SQL-only constraint preservation or installation acceptance is established by the snapshot comparison or patch hashes.

Privacy and the Platform/WF owners must review the declarations and their classifications on the selected combined source. After acceptance, actual combined catalog tests must show an omitted table fails closed, declared unsupported tables remain visible blockers, and existing candidate proof/authority checks remain enforced. This artifact supplies none of those runtime results.

## Exact source and artifact hashes

```json
{
  "status": "proposed_owner_review_only",
  "date": "2026-11-01",
  "base_commit": "a0490c16a9954d9a03c3bb22bfb69944db433a77",
  "agency_snapshot_commit": "8564cd72a4eb95a0b6f5320b7c667460bd7d6f0d",
  "target_path": "src/features/privacy/discoveryCoverage.ts",
  "base_git_blob": "28cea16013b54d2826256f56095e68450d08a3e4",
  "base_file_sha256": "607302829ec6871a3b2c5eff4ff958365fb14d677264a060577bc02a0ba6cf54",
  "proposed_file_sha256": "6f366d6ed0b5f52c099959988c2d60e154d3befaf29eabac8b8d060d2a9b0ccd",
  "patch_sha256": "089ce0ae4195b6ce0fc4a5662ce87b8ffbcfc0f6625c6888b3ad9fa5374ce803",
  "common_0082_snapshot_sha256": "3b26d54e4602737812ca9af0637e812df9b5d7cf198f34e2c78cd28f979dd54a",
  "agency_0083_snapshot_sha256": "6321c6665ac57e072e1fdde13731947ea0333643ee419473178f6dfd35f1717f",
  "agency_0084_snapshot_sha256": "c81d1e7dc7b3101870890966b53ff2d92cb182b81c273e7add03303ba8e9d613",
  "common_0082_bytes_identical": true,
  "common_0082_table_count": 82,
  "agency_0083_table_count": 85,
  "agency_0084_table_count": 89,
  "table_count": 7,
  "tables": [
    "integration_connections",
    "integration_events",
    "integration_oauth_attempts",
    "workflow_runs",
    "workflow_steps",
    "workflow_versions",
    "workflows"
  ],
  "classification": {
    "status": "unsupported",
    "scope": "candidate_links_only"
  },
  "source_registry_and_writer_digest_review": "separate_open_gate",
  "patch_applied": false,
  "application_checks_run": false,
  "upgrade_qualified": false
}
```

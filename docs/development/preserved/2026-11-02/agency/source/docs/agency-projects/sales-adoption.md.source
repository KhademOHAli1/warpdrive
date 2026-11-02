# Committed Sales source adoption

1 November 2026. Sales source `f006b5a5026449fd2bf792439b9149ba3517feb8` is adopted by a three-way source merge into Agency pre-merge `ba2aeb0c0e13cd4610be974031c4c9f05aec8a48`. The common ancestor is `6b71b771d921df8930eebc15259ec0648bff0b73`. The complete Sales delta changes 178 paths; the merge has no textual conflicts. No peer dirty files or runtime state are adopted.

The source preserves newer board/list/contact/lead saved-view recovery, bounded query/cache scope, pipeline directory and guarded rename, plus Sales stage-template parsing and preview. Adopt the related callers together: `renamePipeline` now accepts native `Headers`, expects `expectedUpdatedAt` and returns an updated timestamp through its action; saved-view availability and null definitions must not be coalesced to empty filters; `fetchDealListRows` requires an abort signal. Sales stage templates are acquisition configuration, distinct from Agency production roles/deliverables/dependencies. Neither catalog supplies a runtime installer.

There are no new dependencies, lockfile changes, migrations, database schema, native-auth implementation, shared permission registry or generated UI primitives in the Sales delta. `package.json` gains two source-tooling scripts. Config adds default-false `SALES_PIPELINE_LIFECYCLE_ENABLED`, two message namespaces/declarations and development webpack cache policy. No private env file is changed and no lifecycle flag is enabled by this merge.

The exact Settings navigation and all merged Settings catalogs are preserved from Agency's committed presentation adoption. The immutable Agency baseline also remains byte-identical. Sales' approved CSV is retained byte-for-byte with BOM and CRLF; the initial whitespace check reported 129 CRLF findings in that one frozen file. A path-scoped attribute preserves that original representation, matching the existing Agency baseline approach. Source bytes are not rewritten to satisfy whitespace tooling.

## Evidence and remaining gates

The Sales owner's 1 November `outputs/sales-storage-coordination-request.md` binds `f006b5a` to owner-reported 6,068 unit tests in 972 files, 245 PostgreSQL tests in 51 files, typecheck and lint. Its current-source production build remains pending. Earlier build, worker, native-browser and restore evidence belongs to earlier cuts and does not qualify this source or the combined Agency candidate.

No Agency test/type/lint/build/install campaign is started during the coordinated MAIL recovery window. Combined messages/types/lint/unit/build, current native UI/auth journeys and applicable migration/recovery checks remain open. Source integration is not task, runtime or release acceptance.

SP-09 still has no committed Sales-to-Agency command, DTO, persisted receipt or admission hook. All eight SP-09 ledger tasks are planned at this Sales checkpoint. Existing pipeline admission/native locks are not a general project permission or revocation fence. The four-store Agency delta and its owner review/allocation gates remain independent and unchanged.

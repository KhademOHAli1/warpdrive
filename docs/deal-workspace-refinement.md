# Deal workspace refinement

Branch: `codex/deal-workspace-premium`, based on main `714eda0`.

## Scope and ownership

This is one reviewable Sales UI increment: a compact deal header, a narrower customer-context column, a bounded next-action area with urgency ordering, truthful loading/error states, and custom-field creation in context. Shared navigation, dependencies, migrations, provider integrations and other roadmap work are outside this increment. Existing main-checkout sidebar changes were preserved and excluded.

## Design references

- [Lightfield opportunity overview](https://mobbin.com/screens/1b063065-5db5-46e9-9e21-a5953fd1d58a): separate the short opportunity context from deeper properties.
- [Apollo deal workspace](https://mobbin.com/screens/591c4be5-9288-4c2c-a053-c69e213dd25c): make upcoming work explicit and keep deeper fields available separately.
- [Pipedrive deal workspace](https://mobbin.com/screens/79bfc260-531b-4cd9-bc7e-7764d1fc5b30): collapse secondary details and provide an activity action from the working area.
- [Salesforce follow-up flow](https://mobbin.com/flows/37552a90-fcee-4dd9-a281-5ec95408f054): keep the existing activity and follow-up journey connected.

The product keeps its own type, green accent, components and EN/DE/FA presentation. The header/facts placement and bounded three-action preview are design decisions for this workspace, not measured usability outcomes.

## Custom-field architecture

Definitions remain rows in the existing `custom_field_defs` table. A definition applies to its entity type; each deal stores only its own values in the existing `deals.custom_fields` JSONB object. Adding a field does not add a table, column, index, endpoint, service, dependency or migration.

The server derives whether to show definition creation from `metadata.manage`. The existing CSRF-protected definition action independently rechecks permission and validates the type, name and options. Definitions remain optional by default. Existing typed value validation, partial JSONB updates and concurrency checks remain responsible for saves. A new definition opens its first value editor directly. The definition form is reused by Settings and the deal workspace; its input now matches the existing server name-length limit.

Deal custom fields are displayed separately from organization fields, including deals without a linked organization. Existing section preferences and editing controls remain available. Compact styling is opted into only by the deal workspace; shared contact and lead defaults are preserved.

## Verification

Test-first failures were observed for ordering, bounded actions, loading/error/retry, contextual field creation, immediate first-value editing, collapsed-section editing and failed/pending history tabs. The initial regression set passed 798 tests in 128 files. After the history-state refinement, a focused follow-up passed 173 tests in 32 files. Configured type generation/typecheck, scoped Biome/ESLint and translation checks have passed during implementation. Follow-up checks passed 136 tests in 22 files for field/inline editing, 50 tests in 10 files for the final deal/read-model/header changes, and 14 tests in 3 files for timestamp hydration and history rendering. These are overlapping regression sets, not additive test totals.

Stage qualification, stakeholder roles, history search, proposal tools and post-sale handoff remain later increments in the existing Sales roadmap.

### Browser and database verification

An isolated PostgreSQL 16 database with synthetic data was migrated from the branch base. Real browser interactions created a single-option deal field, opened its first value editor, saved High, changed it to Normal and verified the persisted value after reload. The pending state was visible while saving. All public table columns and all 53 other deals' custom-field values matched the pre-test snapshot. Existing JSONB values on the edited deal were preserved.

Scheduling an activity from Next actions linked it to the current deal; completing an open activity moved it into History. Known custom-field option IDs resolve to their labels for display without rewriting the stored audit trail. Timestamp attribution hydrates from a stable ISO value before localizing in the browser, avoiding minute-boundary and server/browser Intl differences.

Desktop English, German and Persian layouts were inspected. At 390px the working area precedes the context column, stage labels retain their width in a local horizontal scroller, and document width stays within the viewport. Final English navigation reported zero console errors. Actual browser captures use synthetic data; only developer chrome and animations were hidden.

The preview required fixture setup fixes: legacy seed mailbox conflict handling and creation of the reminder queue without running background consumers. The first scheduling attempt inserted its activity but failed on the missing fixture queue; a subsequent complete scheduling journey passed after fixture repair. A reload during an earlier in-flight field save also reproduced confusing feedback; the field editor now displays its pending state. Local Documents-folder I/O stalls were resolved by repairing the same branch/worktree into the Developer folder, with all edited file hashes preserved.

No production build, deployment or measured usability study is claimed. Existing definition-name slug generation still requires a name that yields an ASCII key; changing that backend contract is outside this UI increment. Removed options or unavailable definitions keep their recorded audit values rather than inventing historical labels.

### Integration source-inventory review

The full CI unit lane caught two missing derived-source classifications and five stale reviewed-source digests. The field form now lives in the shared custom-fields feature, with the Settings entrypoint delegating to it. Its draft name/type/options are transient browser state; creation still calls the existing CSRF- and metadata.manage-guarded definition action. It remains classified with the existing settings/infrastructure boundary, with no additional storage or external transport.

The custom-option history resolver maps already-authorized audit values through the loaded definition options in memory. Its CRM classification covers derived business/custom-JSON/history content; it does not mutate the audit trail, expand the query or grant disclosure authority. The tab container retains deal-scoped notes, changes, email, draft and file reads; retry/loading and queue presentation add no destination. Sidebar changes move deal fields into their own section while retaining per-entity save actions and existing enrichment/prospect entrypoints. Opening collapsed sections does not itself invoke those services. Existing subject/third-party handling, retention and unsupported lifecycle capabilities are unchanged.

Only these reviewed literal declarations/digests were updated. The current source report was regenerated with zero missing/invalid IDs and matched a fresh independent CLI run. The 20 registry/validity tests and two real migrated-PostgreSQL catalog tests passed. This inventory repair supplies source classification, not production privacy acceptance.

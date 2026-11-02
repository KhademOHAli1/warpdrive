# Template role-binding/use preview, proposed AP-05.3 increment

1 November 2026. **Pure preview implemented after observed missing-module RED and 11 failed/2 passed behavioral RED. All 13 selected cases pass after refactoring and formatting. Focused noEmit, Biome and unchanged-rule typed ESLint pass for all three new TS files.** The three new TS files are feature-local under `src/features/agency-projects/templates`. The original ten-case outside-source draft and exact recovery copy remain historical preparation, not a second executed suite. No native eligibility, date, installation, database or app action is included.

AP-05.3 ultimately requires an exact install preview with unresolved mappings and chosen date/workweek rules. This increment proposes only pure role binding and source-use inspection. It is not that full install/date/capability preview, activation admission or accepted native workflow.

## Actual source boundary and one proposed API

`previewTemplateRoleBindings(manifest: TemplateManifest, bindings: unknown)` returns actual `Result<TemplateRoleBindingPreview, "invalid_template_bindings">`. The feature-local `./templateRolePreview` implementation now provides the pure projection. No shared helper or registry API is added.

`TemplateManifest` is the actual type exported by `templates/templateManifestSchemas.ts`. A caller must already have accepted the manifest through `parseTemplateManifestJson()`, including its existing graph pass, or an equivalent owner-approved trusted loader. The preview trusts that typed, validated manifest and does not repeat structural/graph validation or accept raw JSON. It validates the new `bindings` boundary once, using strict feature-local tagged schemas and the actual `canonicalUuidSchema` for native identity syntax.

Actual v1 limits are 32 roles, 128 deliverables and 256 intents. Role IDs are stable local IDs. Existing graph validation requires internal-producer roles for deliverable responsibility/follow-up/review assignees/assignment accountability, and freelancer-contact roles for assignment freelancers. Later-stage review intents may reference deliverables in an ancestor stage. The preview reads those accepted fields without assigning work or resolving native entities.

The placed tests use actual `readStarterTemplate("campaign_content")` data as a fixture, adds a reviewer and an unused role in its private copy, then reparses through the actual manifest JSON boundary. This produces a validated manifest with all five role-use fields, a later-stage ancestor-deliverable review, a negative offset and nonchronological intent offsets. It does not alter the starter catalog.

## Strict binding input

Input is an explicit array with at most 32 rows, each one of:

```ts
{ roleId: string, kind: "internal-user", userId: string }
{ roleId: string, kind: "external-contact", personId: string }
```

Each row is strict. The local `roleId` must match a declared manifest role exactly, without case folding. Internal-user binds only internal-producer; external-contact binds only freelancer-contact. UUIDs use the actual canonical lowercase normalization. Names, emails, labels, mixed identity fields, authority booleans and activation/action shortcuts are not bindings. Null/undefined/nonarray inputs fail rather than become an empty mapping.

Duplicate role IDs fail, even when their target is identical. Unknown and wrong-kind roles fail without partial output or a chosen winner. Missing role rows are valid and appear as unmapped. Different roles may intentionally reuse the same selected user/contact; the preview must not deduplicate by identity. Equal UUID bytes in different tagged namespaces remain distinct internal-user and external-contact data, not a global identity merge. Native identity existence and eligibility are not checked here.

## Proposed detached output shape

The result contains exactly `templateId`, `version`, `roles` and `offsetAssumptions`:

- Exact input template ID and version, with no new UUID, receipt or persisted publication claim.
- One role row for every `manifest.roles` entry in its existing order, including unused roles: `{roleId, roleKind, binding, uses}`. `roleKind` is the actual manifest kind. `binding` is null for unmapped, or the selected tagged target without repeating `roleId`.
- Each role's exact uses, with deliverables in `manifest.deliverables` order first, then intents in `manifest.intents` order. This explicit cross-collection order is a proposed presentation convention, not a new task order or schedule.
- `offsetAssumptions` in intent order: `{intentId, dueOffset}`, preserving `basis`, `anchor` and signed `days` exactly.

Use rows expose only actual source local IDs and the exact role-bearing field:

| Use `kind` | Exact row data beyond `kind` |
| --- | --- |
| `deliverable` | `deliverableId`, deliverable `stageId`, `field: responsibleRoleId` |
| `follow-up` | `intentId`, intent `stageId`, `field: assigneeRoleId` |
| `assignment` | `intentId`, intent `stageId`, `deliverableId`, and either `field: internalProducerRoleId` or `field: freelancerRoleId` |
| `review` | `intentId`, review intent `stageId`, `deliverableId`, `field: assigneeRoleId` |

An ancestor-deliverable review retains the review's own later stage and the exact referenced deliverable ID. Roles unused by any source record have `uses: []`; mapping them is still syntactically valid. Labels/descriptions and complete task/dependency records are not duplicated in this smallest output. A UI/full install preview may need a later owner-reviewed projection, not hidden extra fields in this API.

Both directions of mutation isolation are required. Computing the preview must not mutate, reorder, normalize in place or freeze caller inputs. Output edits must not change inputs or later previews; later caller-input edits must not alter an earlier result. Detached mutable output or independently immutable output is acceptable, provided caller-owned input is untouched. The tests use check-only `Reflect.set` for output edits so either output strategy can satisfy isolation. This is object ownership, not database immutability or durable replay.

## Limits and genuine output choices for root review

The API provides no `canInstall`, native eligibility status, dates, generated IDs, install receipt, task command, registry action, activation, sender, provider or persisted mapping. Binding success means syntax/kind/source-use consistency only. It supplies no authenticated freelancer/client, workspace identity, access grant or commitment.

No calendar/timezone/workweek/holiday defaults are inferred, and offsets do not become deadlines. Date/calendar agreement, exact dated preview, accepted active staff/contact mapping, capability availability, current project/CRM scope, Privacy, installation/idempotency/restore and existing WF/activity integration remain separate gates. Missing mappings being valid preview data does not permit later installation or activation. No native/store dependency is needed to implement this pure projection.

Two presentation choices are genuinely not settled by existing manifest schemas: the public preview's exact field names, and ordering uses across the separate deliverable and intent collections. This draft chooses `roleKind`, null for unmapped, exact source field names and deliverables-before-intents. Root selects that initial pure output shape for the later test-first source increment. This selection accepts no native/install contract. The draft adds no labels/full task graph; root must separately decide whether a future UI projection needs them. These choices do not alter manifest validation or commercial/native authority.

## Exact proposed cases and status

The thirteen placed cases cover: all roles/unmapped/unused; canonical UUIDs and stable order without input mutation; exact five-field role uses and ancestor review; unchanged signed offsets/minimal output; same-identity reuse across roles; equal UUID bytes across tagged namespaces; duplicate/unknown/case/wrong-kind denial; strict malformed/extra-field denial; output-to-input/future-call isolation; input-to-prior-output isolation without freezing inputs.

Root observed the missing-module RED, then11 failed/2 passed against the rejection scaffold, then13/1 GREEN before and after separating per-intent projection. Additional cases prove mapped unused roles, valid empty-work manifests and the32-role bound; role-row key allowlists and caller-container nonfreezing are also checked.

Focused noEmit/Biome/unchanged-rule typedESLint for the exact three new TS files now pass. Initial Biome reported three formatter-only diagnostics, then formatting, repeated types/Biome, typed ESLint and actual13/1 post-format units passed in a serial15.761580-second source window. All seven owned source-check groups46124/46140/46410/46422/46438/46449/46461 were terminal and observed empty, with minimum14,545,453,056 free bytes. The four unit groups44323/44380/44659/45056 were terminal and observed empty, each using one worker, a30-second total guard with29-second execution cutoff and a live5GiB floor. Exact current source hashes, logs, scaffold and receipts are indexed by `qualification-template-role-preview-20261101.json`. This supplies no native eligibility, install, UI or task acceptance. The recovery text remains an exact historical copy of the outside-source draft.

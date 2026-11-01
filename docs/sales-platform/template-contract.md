# Stage-only template manifest and preview

SP-04.1 source increment, 31 October 2026. This contract and pure preview do not
install a template, create a pipeline, upgrade records or activate rules/effects.
SP-04.1 and the remaining approved SP-04 tasks stay open with their dependencies.
No runtime interface is wired to a route or user screen by this increment.

## Boundary and supported meaning

`src/features/process-templates/templateManifest.ts` accepts JSON text, not a live
JavaScript object. It returns a `Result` with a validated, deeply frozen manifest
or safe error code/paths. It does not echo raw rejected values. JSON object keys
must be unique after Unicode unescaping, including nested objects. Prototype and
unknown properties fail the strict schemas; functions, getters, scripts and
provider command objects have no accepted configuration slot.

Schema version 1 requires:

- A stable template key, positive content version and explicit original-source
  provenance key/revision. No URL is fetched and no referenced source is executed.
- Farsi, German and English title, description, pipeline name and stage copy.
  Authored whitespace, mixed-direction text and language are retained. Locale
  selects copy only for a proposed new pipeline, never existing CRM text.
- A nonempty ordered stage array with unique stable stage keys. Array position
  becomes zero-based native order. Names respect the existing 255-character
  application limit; `rottingDays` is null or a positive PostgreSQL integer.
- Explicit requirements for `pipeline.name`, `stages.ordered`, `stages.name` and
  `stages.rotting-days`. These are new manifest identifiers describing existing
  fields, not exports from a new automation engine.
- Empty field-reference, rule and action arrays. Populated arrays and arbitrary
  metadata/effect bags are rejected. A future qualified field/rule/action contract
  requires explicit schema evolution; it is not represented by executable code.

The bounded-input policies are 64 KiB of UTF-8 JSON, 32 stages, 16 capability
requirements, stable keys up to 64 characters and localized descriptions up to
1000 characters. These are new manifest limits, not claims about native pipeline
capacity. Unknown schema versions fail. Unknown capability identifiers can be
retained as bounded declarations, but the preview returns an unsupported result
with no partial plan.

Native sources are `src/db/schema/pipelines.ts`, `src/db/schema/stages.ts`,
`src/features/pipelines/schemas.ts`, `src/constants/defaultCatalog.ts` and
`src/features/deals/cardIndicators.ts`. Existing stage aging is an indicator
strictly after the configured whole-day threshold. It is not a deadline,
reminder, stage transition or automatic communication. Won/lost/open remains a
deal status; a stage name never assigns that status.

## Preview and catalog

`planProcessTemplate` consumes the validated manifest plus the existing trusted
`Locale` type. It returns a frozen `preview-only` structure with a pipeline
operation key and stable stage-key to proposed-operation mapping. Every proposed
stage has the selected label, array order and configured aging indicator.

The preview neither accepts nor allocates native pipeline/stage IDs. It does
not match by name, reuse an existing stage, rewrite an existing record, grant
visibility or admit an automation. Identical stage names retain different stable
keys. Changing the display locale changes proposed copy while operation keys
remain stable. Installation is explicitly `unavailable` even for a supported
manifest; a successful preview is not an authorization or an installation receipt.

`readBasicProcessTemplateCatalog` provides original, optional starting structures:

- Basic sales: initial review, understanding needs, proposal and decision.
- Start with one stage: a minimal structure for the user's own process. It has
  one stage because the existing UI considers a zero-stage pipeline unusable.

Both provide Farsi/German/English copy, no aging threshold by default, and no
fields, rules or actions. They do not replace the existing default catalog or
create route. Their copy is an original design proposal, not measured sales
research or contextual native-language acceptance. Advanced tender, partner,
enterprise and renewal manifests remain approved future work.

## Evidence and remaining gates

The focused unit suite passes 36 tests across three files. It covers malformed
versions/keys/fields, duplicate JSON keys including escaped aliases, bounded
UTF-8 input, prototype keys, secret/provider/script configuration slots,
invalid aging, immutability, raw text preservation, stable-key mapping,
unsupported capability refusal and the localized basic/one-stage catalog.
Recorded red and green runs are in the task-owned private evidence directory.
No DB, browser, installation, external service or production build is qualified
by these tests.

Schema validation cannot detect a secret pasted into an otherwise valid plain
text label or certify the provenance claim. Trusted catalog review remains
necessary. Future UI must render labels as text, never executable HTML. This
contract is not a data-loss-prevention system or a permission boundary.

Object immutability and versioned identity do not prove historical catalog
immutability. Before installation, the owning persistence design must bind an
immutable version to its exact content, establish durable creation-intent
idempotency and explicit native ID mapping, recheck current native authority and
scope, and atomically commit pipeline/stages/audit/receipt or roll all back.
No audit-correlation uniqueness or workflow receipt is repurposed for this.

Template upgrades still require stored provenance and local-override tracking,
reviewed mapping, conflict handling and preservation of existing stage IDs,
records, saved views, workflow references and analytic meaning. Allocator-owned
DDL and actual supported-lineage recovery remain gates. The current manifest
has no custom-field resolution, activated stage rules, duplicate-existing adapter,
installer, upgrade engine, UI or effect execution.

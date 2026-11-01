# Qualification research catalog and pure preview

Partial SP-05.1 source increment, 1 November 2026. SP-05 and all approved SP-05
tasks remain open. This module supplies original neutral research guidance, not
an installed framework, legal clearance, persisted pipeline choice or seller
assessment. Its input is the [framework research](qualification-framework-research.md)
and approved SP-05.1, SP-05.2 and SP-05.4. It does not extend the existing
[stage-only template manifest](template-contract.md).

## Definition boundary

`src/features/sales-qualification/qualificationDefinition.ts` accepts bounded JSON
text and returns a `Result` containing a deeply frozen definition or safe error
code and paths. Schema version 1 requires a stable definition key, positive
content version, FA/DE/EN title and description, and unique stable criterion keys
with original localized labels, descriptions and prompts. Definition and
criterion keys identify content; they allocate no native IDs or field mappings.

The contract limits UTF-8 input to 64 KiB, criteria to 16, keys to 64 characters,
labels/titles to 255 and descriptions/prompts to 1000. Whitespace-only copy,
control characters, invalid dates, duplicate criterion keys and duplicate JSON
object keys (including escaped Unicode aliases) fail. Unknown properties,
prototype keys, unsupported versions, native field/pipeline/stage references,
rules, scripts, actions and evidence payloads have no accepted slot. The parser
reuses the existing pure duplicate-key utility without changing the stage parser.

Original provenance contains a source key, positive revision and author group;
`reviewStatus` remains `pending`. Research metadata contains one to six bounded
reference names, HTTPS URLs and access dates; `rightsStatus` remains `pending`.
The author group is catalog authorship metadata, not an individual approval or
legal finding. Metadata is declarative and no source is fetched. Successful
schema validation cannot establish authorship or rights, detect confidential
text pasted into guidance, or approve a new catalog revision. A future surface
must render the strings as text and review content before distribution.

## Neutral catalog and preview

`readQualificationCatalog` returns six frozen original entries. The names in the
second column occur only in research metadata, with URLs from the reviewed source
document. They do not appear in the localized preview.

| Stable key | Research reference | Original evidence concepts |
| --- | --- | --- |
| `buying-readiness` | BANT | Funding constraints, approval participants, customer need, buyer timing. |
| `complex-purchase-review` | MEDDPICC | Value evidence, spending authority, evaluation requirements, approval path, contracting path, problem consequences, internal support, alternatives. |
| `customer-context-review` | SPICED | Operating context, reported difficulty, consequences, external milestone, decision requirements. |
| `discovery-conversation` | SPIN | Current work, friction, downstream effects, customer-described benefit. |
| `commercial-hypothesis` | Challenger | Hypothesis source, stakeholder relevance, customer response including disagreement, shared next step. |
| `mutual-working-agreement` | Sandler | Meeting purpose, customer concern, resources, decision participants and steps, agreed next action, post-decision expectations. |

The catalog does not reproduce vendor scripts, courses, scorecards, diagrams,
choreography, logos, badges or certification assets. Neutral copy remains a draft
subject to content and FA/DE/EN contextual review; independent wording does not
settle naming, trademark, contractual or distribution rights.

`previewQualificationDefinition` consumes a parsed definition and the caller's
FA/DE/EN locale. Unsupported locales fail instead of silently selecting another
language. Preview output preserves definition key/version and criterion identity
as `definition-key@version/criteria/criterion-key`; changing locale changes copy,
not identity. A different content version produces different criterion identity.
Array order is authored display order, not a required conversation sequence.

Output is frozen and explicitly `preview-only`, with native IDs `unallocated`
and rights `pending`. Installation, persisted selection, evidence writes, scoring,
stage policy and effects are all `unavailable`. No installer, database, session,
role, fetch, clock, service, IO or side effect is present. A successful preview is
neither authorization nor an installation/selection receipt. The existing basic
and one-stage blank process templates retain their independent stage-only path.

## Requirements still open

SP-05.1 still requires a reviewed rights decision for the exact copy, naming,
languages, distribution and applicable territories, plus actual opt-in selection
per pipeline. There is no persisted selection or switching behavior in this
increment. No parallel store, custom-field schema or migration is introduced.

SP-05.2 remains a documented requirement: distinguish unknown, supported,
contradicted, disputed and not-applicable assertions; confidence is an explicit
assessment, not proof. Durable assertions need source references, author,
reviewer, observation/review times, freshness policy/version and independent
field/source authorization. Missing dates cannot imply freshness, and missing
information cannot silently become a negative answer. Revocation and hidden
source references need safe unresolved states without existence leakage.

SP-05.4 remains a documented requirement: keep completeness separate from risk,
bind rules to explicit versions, applicability, freshness and contributing
permitted evidence, and explain unsupported/unknown results. Hidden or
unassessable evidence cannot leak through scores, counts or reasons. No win
probability, functional score, vendor certification or automatic stage block is
implemented.

Storage-owner allocation and exact native lineage, durable content/version
binding, historical evidence preservation, switching/upgrade semantics,
independent authorization, retention/deletion, audit, UI, contextual language and
accessibility review, and native installation/recovery qualification remain
gates. Source parsing and object freezing do not prove historical immutability
or an installed capability. These parents and acceptance gates stay open.

## Verification ceiling

The focused behavioral unit lane covers parsing, immutability, duplicate keys,
bounds, unsupported payloads, localized catalog completeness, stable preview
identity and unavailable capabilities. Its executed result is recorded in the
coordinator's source handoff. No DB, native UI, application build, installed
framework, durable evidence, legal acceptance or release is qualified here.

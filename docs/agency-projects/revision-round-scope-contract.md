# Explicit revision rounds and recorded included scope, proposed pure contract

1 November 2026. Status: **31 selected cases pass across two files after actual missing-import and behavioral reds; static checks and a current integrated run are pending**. This is bounded AP-06.3/T13/T15 pure-parser/classifier evidence. No quotation acceptance, native authority, stored round history, approved extra work or financial action is established.

The implementation adds `reviews/revisionRoundScope.ts` and `revisionRoundScopeSchemas.ts`, two test suites and a shared fixture. The earlier qualified 47 files remain byte-identical. Strict Zod schemas infer the ingress types, and the evaluator consumes validated inputs without a second parse. No existing helper, route, store, database schema, package or application configuration changed.

Actual guarded process evidence: missing-module red PID 59405 terminated with exit 1 (two failed suites, zero assertions); behavioral red PID 59586 terminated with exit 1 (12 failed, 19 passed); selected green PID 59877 terminated with exit 0 (31 passed in two files, 164 ms reported duration). All three owned groups were empty, no deadline/floor stop occurred, and minimum observed free bytes were 19,895,930,880. Commands, terminal receipts and raw logs are retained in `evidence/revision-round-scope-unit-handles.json` and the corresponding red/green logs. A separate 52-file static-check window is requested; it has not run or been inherited from the completed manual batch.

## Small feature-local API and actual reusable boundaries

- `parseRevisionRoundDeclaration(unknown)` returns `Result<RevisionRoundDeclaration, "invalid_round_declaration">`.
- `parseRevisionRoundAllowance(unknown)` returns `Result<RecordedRoundAllowance, "invalid_round_allowance">`.
- `evaluateRevisionRoundScope(round, allowance)` consumes validated same-scope/version data and returns `Result<RoundScopeAssessment, "round_scope_target_conflict" | "round_scope_version_conflict">`.

The implementation reuses actual `canonicalUuidSchema`, `revisionSchema`, `referenceSchema`, `exactInstantSchema` and `plainTextSchema`, all already present in the feature. The module imports no invented financial/source API and changes no helper. Positive integers derive from the actual safe nonnegative integer schema with a minimum of one; included count admits agreed zero. Bounds are representational safe integers, not an operational correction/history cap.

## Explicit round and versioned allowance

The public-shaped round declaration contains only canonical `projectId`, canonical `deliverableId`, explicit positive `roundNumber` and positive `expectedAllowanceVersion`. It accepts no feedback request count, review epoch, history or native recorder fields. A missing ordinal cannot be inferred. The number is an explicit declared ordinal, not a count that this evaluator consumes or increments.

The allowance is explicitly per deliverable. These fields cannot represent or divide a pooled or project-wide commercial round limit; no caller may copy such terms into multiple per-deliverable allowances and claim equivalent scope. Establishing the actual scope unit remains a commercial-owner contract. Exact work-version binding and round identity/lifecycle remain AP-06.1 dependencies. This evaluator does not associate a declared ordinal with an external content version, feedback request, reopened review or completed round, and accepts no arbitrary version-reference shortcut.

The private server-assembled allowance header contains the same project/deliverable scope, positive `version`, fixed `provenance: staff-recorded`, canonical `recordedByUserId` and an exact offset-qualified `recordedAt` instant. This metadata is required even for an explicitly staff-recorded unknown declaration. It is not synthesized for a missing source. Validating a native UUID/time establishes syntax only; an authorized loader/request path must supply real provenance before runtime use. There is no public allowance-creation route in this proposal.

Allowance variants are strict and distinct:

| Kind | Required variant data and meaning |
| --- | --- |
| `unknown` | No included count/source is established. No `includedRounds`, agreement source or evidence fields are inferred. |
| `agreed` | Explicit nonnegative safe-integer `includedRounds`, substantive single-line `agreementSource` up to 160 UTF-16 units, and exact protected `evidenceReference` up to 2,048 units. These are staff-recorded agreement claims and supporting references. |

Agreed zero remains known zero and requires its source/evidence. It is never treated as unknown. Negative, fractional, unsafe, null or string count values fail rather than become a default. `agreementSource` preserves Farsi/German text, embedded Persian joiners and permitted source whitespace; format-only/control text fails the existing plain-text boundary. Evidence syntax is validated without normalization or fetching. Recording instants preserve the supplied offset/fraction, with the actual exact-instant helper's supported precision.

Explicit unknown is a staff-recorded declaration only. Missing, denied, deleted, malformed or inaccessible data is not an unknown allowance and must not be synthesized into one. Parsing null/undefined, missing evidence or denial/deletion variants fails. Selecting available records and enforcing source visibility or removal are future native loader responsibilities.

One allowance version identifies the recorded terms used by the assessment. An actual immutable version/source lineage, changes/revocation and native authority are later loader/storage contracts. Types and comparing a supplied version do not prove publication immutability or that a record was genuinely agreed. No history arrays, correction-count cap or generic publishing engine are introduced here.

## Evaluation is contextual classification

Before classification, project/deliverable must match and `expectedAllowanceVersion` must equal the supplied allowance version. Wrong targets and supplied-version mismatches return explicit conflicts. This does not prove currentness: matching old, superseded or revoked terms can still be compared as supplied. The evaluator does not select newer terms, establish an effective date, fall back to unknown or widen scope. Its result means classification against these supplied recorded terms, never current entitlement or permission to begin work.

The result contains only scope IDs, the unchanged explicit round number, allowance version and one classification:

| Classification | Meaning |
| --- | --- |
| `allowance-unknown` | This supplied staff-recorded declaration explicitly establishes no included limit. It does not mean a source read was denied, missing or deleted. |
| `contextual-included` | The explicit ordinal is at or below this staff-recorded included limit. It is contextual included work only. |
| `scope-review-required` | The ordinal exceeds the recorded limit, including round one against agreed zero. Extra scope needs explicit review. |

The inclusive boundary is intentional: recorded N includes declared round N; declared round N+1 needs scope review. Neither comparison counts feedback requests, reads `reviewEpoch`, consumes a remaining-round balance, allocates tasks or schedules work. Repeated evaluation of frozen identical inputs must be identical and leave both declarations untouched.

This repeatability is not durable replay, declaration deduplication or round accounting. There is no mutation intent, receipt, current-head selection or append event here. Comparing another allowance version must not alter the result for an unchanged old supplied pair, but that property neither restores old terms as current nor proves a retained historical record. A future round/allowance writer must define stable round identity, correction and version lineage, authorized replay, expected-revision conflict behavior and retained source/assessment provenance. No history arrays, retention limit or correction-count cap are introduced to substitute for that contract.

No classification authorizes work, establishes authenticated client approval, approves extra scope, sets a price, creates a charge, changes a budget or issues an invoice. The strict schemas reject authority/signature, financial and inference shortcuts as unknown fields. It adds no sender, task engine, grant, consent flag or external account behavior.

## Protected sources and real commercial gates

Agreement/source text, native recorder provenance and references remain protected context. Evidence URLs may contain bearer/invitation tokens; parser acceptance proves neither harmlessness nor authority to disclose them. No routine logs/diagnostics, automatic public/outbound projection, remote preview or fetching may expose these values. The assessment does not copy source evidence/native recorder fields into its output, but any eventual UI/export still needs current scope policy and Privacy review.

An opaque staff-recorded reference is not an accepted quotation revision or financial baseline. The actual reviewed quotation/commercial source contract remains IG-12/13 ownership and a hard dependency for any accepted commercial baseline or financial handoff. This implementation invents no quotation fetch, source verification, charge, budget or invoice API to bypass it. Old/new source authority, actual staff identity, scope visibility, retention and immutable version persistence need their own real evidence. T13 hidden-source access and T15 handoff/history acceptance are not closed by a scalar evaluator.

## Current evidence and remaining qualification

The 31 selected cases cover explicit ordinals and supplied-version matching; unknown/zero/inside/outside distinctions; inclusive limits; canonical IDs; substantive recorded source/evidence; exact protected reference/time preservation; invalid numbers and authority/financial shortcuts; target/version conflicts; repeatability without mutation; minimal output without source/recorder leakage; and maximum safe-integer comparison. Missing, denied, deleted or malformed source data never becomes an unknown allowance.

These executions qualify only the selected pure boundaries and comparison behavior. Static/integrated checks remain pending. No round recording, immutable version storage, current-term selection, correction/replay/history, native permission, Privacy disclosure, actual financial handoff or original task acceptance follows from this result.

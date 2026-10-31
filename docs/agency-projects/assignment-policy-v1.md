# Assignment lifecycle policy v1, proposed internal policy

31 October 2026. This is a pure source increment for AP-04.3 and T08/T09. It is not an enabled assignment API, authority decision, database implementation or accepted release. The graph remains subject to domain and integration review.

| Current state | Explicit admitted action | Next state |
| --- | --- | --- |
| Awaiting acceptance | Record externally received acceptance | Working |
| Working | Record an identified submitted version | Submitted |
| Submitted | Begin internal review | Internal review |
| Internal review | Request changes, with reason | Changes requested |
| Changes requested | Resume work | Working |
| Internal review | Approve the exact reviewed version | Approved |
| Any nonterminal state | Cancel, with reason | Canceled |

Approved and canceled assignments are terminal in this increment. No general status setter, reopen action or implicit approval of a replacement version is exposed. A future version-specific reopening policy must preserve historical approval and require a new decision for changed content.

Each command requires the expected assignment revision and recording staff user ID. An admitted command advances the revision once and returns a policy-versioned receipt. Revision mismatch takes precedence, including replay against a now terminal assignment. The caller must later enforce the same comparison atomically in PostgreSQL; these unit tests do not prove concurrent one-winner persistence.

Acceptance requires the selected freelancer person/contact ID and a nonempty evidence reference. The resulting provenance says `staff-recorded`, with the staff user ID, freelancer contact ID and evidence reference. It does not authenticate the freelancer, create an account, grant membership, or send a message. Other progress states also describe internal staff records. Internal approval is tied to the current version reference and is never a client signature or external authentication claim.

Progress requires an active project. Planned, on-hold, completed, canceled and archived projects fence progress. Cancellation remains available as internal cleanup for a nonterminal assignment, including after project cancellation/archive. None of these decisions schedules or dispatches an effect.

Input snapshots and earlier receipts are not mutated. Acceptance evidence is retained through review changes. The accountable internal owner and external freelancer contact remain separate fields. No price, rate, margin, deadline, task-engine state or communication-delivery assertion is added.

## Submitted version and boundary correction

An assignment can be accepted before any artifact exists. Awaiting acceptance requires `versionReference: null`. Working may have no submission yet or retain the last submitted reference while changes are unfinished. An explicit submit command requires `submittedVersionReference` and stores it exactly. The receipt retains previous/new references. Submitted, internal-review, changes-requested and approved snapshots require a reference; approval binds that exact submitted version. Resumed work does not imply approval of unfinished changes.

`assignmentActionSchema` accepts only browser action data and rejects any selected recording actor, membership, authenticated-freelancer or financial flag. Only server code may assemble `assignmentCommandSchema` with the actual native staff actor after request policy passes. UUID syntax is not actor authentication or subject identity; user and person UUIDs are distinct domains even if their strings happen to match. UUID spellings are normalized to lowercase before comparisons, while authored evidence/version references retain their exact case and Unicode.

`assignmentSnapshotSchema` validates stored provenance coherence. Awaiting has no acceptance/approval; working and review states require staff-recorded acceptance for the selected contact; approved requires exact-version internal approval; other states have no current approval. Canceled supports both before-acceptance and after-acceptance history. The producer, acceptance recorder and reviewer may legitimately be different staff.

Reasons are bounded to 2,000 UTF-16 code units, trimmed, and reject C0/C1 controls except ordinary tab/newline/carriage return. References are nonempty, bounded to 2,048 code units, single-line, untrimmed identity strings without markup/control characters. Opaque labels are allowed; URI-shaped references must be explicit absolute HTTP(S) without credentials or whitespace. They are validated without fetching or normalizing the external identity. Supported artifact immutability/project ownership remains a separate server contract.

## Evidence

Pinned Bun 1.4.4, Vitest 5.0.5, one worker, isolated source checkout. The exact scoped command is:

```sh
PATH="$PWD/.runtime/bin:$PATH" bun run test:unit src/features/agency-projects/assignmentLifecycle.test.ts --maxWorkers=1
```

- `assignment-red-missing.log`: exit 1, implementation module absent before production source was written.
- `assignment-red-policy.log`: exit 1, 25 failed and 39 passed, with revision-only scaffolding and unimplemented transitions/evidence guards.
- `assignment-green-policy.log`: exit 0, 64 passed.

Logs are in the implementation chat's `work/` directory. Final source checks and the root evidence ledger record subsequent formatting and review. No database, browser, native auth, provider or migration result is claimed.

## Gates before production use

Boundary Zod schemas now cover UUID syntax/casing, safe integer revisions, bounded reasons/references, version presence, command variants and snapshot coherence before invoking this typed policy. Staff identity, active-account/freshness/CSRF checks, project/CRM/contact visibility, assignment capability, current project state and exact version ownership must come from actual server services, with transactional revision comparison and audit persistence. No raw browser payload may supply the staff identity used by the policy.

The activity/calendar visibility bridge, canonical due/reminder/task ownership, Privacy inventory and writer fences, version-specific review decisions, financial projection policy, migrations and native FA/DE/EN journeys remain separate open gates. No production route or job imports this module in this increment.

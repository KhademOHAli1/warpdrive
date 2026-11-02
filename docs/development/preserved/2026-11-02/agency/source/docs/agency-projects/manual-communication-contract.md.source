# Manual communication record/correction, proposed pure contract

1 November 2026. Status: **the current integrated feature passes 390 tests in 16 files, with feature-local TypeScript, Biome and unchanged-rule type-aware ESLint**. This is bounded AP-03.3/T01/T05/T06/T29/T34 schema/pure-policy unit evidence. It does not establish stored history, native authority, actual communication, Privacy acceptance, full-application qualification or release completion.

The implementation adds strict record/correction schemas and pure policies under `communication/manualCommunication*.ts`. Shared channel/plain-text and exact-instant helpers moved to `communication/communicationValueSchemas.ts` and `instantSchema.ts`; existing preference/review APIs remain unchanged. A separate shared reason fix rejects supplied invisible format-only reasons while preserving optional empty syntax and visible Persian joiners. All affected files are covered by the current integrated checks. Request, command, head, receipt and context types infer from the strict Zod shapes.

Test-first evidence includes a missing-module red (two failed suites, zero assertions), then a behavioral red (16 failed, 6 passed), followed by 22 selected manual cases passing. The reason regression separately failed once with 28 cases passing, then passed all 29 selected cases. The final post-format execution passed all 390 feature cases in 16 files. Raw outputs and process/resource receipts are retained under `evidence/` and indexed by `qualification-manual-20261101.json`.

## Small feature-local API

The feature-local parser/policy source returns `Result` values using the existing application convention:

- `parseManualCommunicationAction(unknown)`: browser data, error `invalid_manual_action`.
- `parseManualCommunicationCommand(unknown)`: server-assembled data, error `invalid_manual_command`.
- `parseManualCommunicationContext(unknown)`: bounded private head/one-intent data and local coherence, error `invalid_manual_context`.
- `applyManualCommunicationCommand(context, command)`: validated private inputs, returning `Result<{snapshot, receipt, appendEvent, replayed}, ManualFailure>`.

These are pure feature-local boundaries and policy source, not routes, a generic idempotency service, a sender, an outbox or a task engine. They read no wall clock, resolve no URI and grant no access. Only schema-validated inputs may reach the policy. The source context refinement establishes local consistency only; it is not an authorized DB loader, restriction fence, uniqueness proof or atomically complete lookup. The actual native-authorized database loader/transaction remains a separate required service gate.

## Record and correct declarations

Every browser action has canonical `projectId`, `personId` and stable `mutationIntentId`, plus `action: record` or `correct`. It contains a complete `declaration` with:

| Field | Proposed bound and meaning |
| --- | --- |
| `channel` | Explicit strict email/phone/WhatsApp/meeting tag, or other with a nonblank single-line label up to 80 characters. No mailbox, recipient or provider configuration. |
| `occurredAt` | Required valid offset-qualified ISO instant, up to nine fractional digits. Preserve the original string and compare instants exactly. |
| `note` | Required substantive protected plain text, up to 2,000 characters. Preserve authored text, permitted ordinary tab/CR/LF, Persian ZWNJ and visible bidi-isolated text. Reject format-only text and disallowed controls. |
| `evidenceReference` | Optional exact protected reference, using actual `referenceSchema` up to 2,048 characters. Empty/null, unsafe schemes, credentials and controls fail; no fetch. |

Correct actions additionally identify canonical existing `logId`, require `expectedRevision`, and carry a substantive protected plain `reason` up to 1,000 characters. Correction replaces the declared current fields as a whole; omission of an optional evidence reference means no current evidence reference is declared. Previous evidence remains in the append descriptor/history, not silently erased. Project and log identity stay fixed. `personId` is the declared recipient and may be explicitly corrected within that same project/log to repair a misrecorded contact. This changes no global contact identity and performs no name/address merge. The real native service must authorize the old/new person and project relationships before admission; this pure policy authenticates neither contact.

Record browser actions cannot choose a new log UUID. All browser variants exclude native recorder/time. The server supplies canonical `recordedByUserId`, actual `recordedAt` and the record action's new canonical `logId` after real request policy passes. Correct commands retain the selected existing log ID. The parser validates supplied syntax/provenance shape but authenticates nobody. Only `staff-recorded` provenance is produced. Draft/copy/send/provider-delivered actions and authentication/delivery/provider assertions are rejected.

Occurrence may be historical, including before the current head's most recent correction. Manual logs do not reuse review-epoch restrictions. It must be no later than the command's recording instant. Explicit offsets and nanoseconds are compared with the actual installed Temporal dependency; `Date.parse` truncation and precision beyond nine digits are not accepted. No locale-derived date, schedule, timezone, digits or calendar transformation is introduced.

The implementation reuses existing `canonicalUuidSchema` and `referenceSchema`. After observed red and root's specific authorization, the actual exact-instant helper was extracted from `reviews/reviewSchemas.ts` into `instantSchema.ts`, and the actual strict channel/source-preserving plain-text helpers moved from `communicationPreferenceSchemas.ts` into `communicationValueSchemas.ts`. Previous consumers import those actual helpers without changing their public schema exports or intended validation semantics. No invented shared engine/auth export is imported. The current 390-case execution and feature-local static checks cover the extracted source graph; earlier results remain historical evidence.

## Bounded context and append delta

Input context is exactly `{current, priorIntent}`:

- `current` is one private current head or `null`: canonical log/project/person IDs, fixed staff-recorded provenance, safe positive revision, exact recording-time high-water and one current declaration.
- `priorIntent` is one scoped prior-intent record or `null`. Applied form contains the original validated browser request and its private original receipt. Deleted form contains only its canonical actor/action/intent key, without requiring erased note/reference payloads to be reconstructed.

No growing history is supplied to the policy, and there is no history/correction business cap or automatic pruning. A fresh record returns a head at revision 1 and an append descriptor `{receipt, before: null, after: {personId, declaration}}`. A correction advances revision once and returns old/new `{personId, declaration}` facts in `before`/`after`. Receipts retain `previousPersonId` (`null` for record) and the admitted `personId`. These descriptors preserve original recipient/content facts and exact correction reason for a later transactional history writer. Returning data does not append or persist it. Full original/correction history remains required, with bounded reads and independently qualified retention/storage behavior.

Private receipt includes policy version 1, staff-recorded provenance, action, actor/action/intent identity, canonical scope/log IDs, old/new revision, original native recorder/time and exact reason (`null` for record). It is not a browser DTO. The append descriptor and both old/new declarations are also protected server data.

The local context parser must check head/receipt/request scope and key coherence, receipt revision increment and correction precondition, occurrence versus recording instant, and receipt chronology no later than the head high-water. Project/log must agree across a head and historical receipt. A historical receipt's recipient may differ from the corrected current head, but must remain bound to its own original request's person. A receipt newer than the head is invalid. If receipt and head share the same revision, their recipient, current declaration and exact recording-time source string must agree. A context contains no `authorized` boolean or history array. These local checks prove neither authenticity nor that the supplied prior lookup was atomically complete; the real authorized persisted loader must establish that evidence.

## Actor-scoped replay and fresh writes

The exact replay key is native recorder UUID, action and mutation-intent UUID. The future loader supplies at most one lookup scoped to that key. A different-key lookup returns `manual_intent_unavailable` without disclosing its receipt; it is not ignored as permission for a fresh write. Applied/deleted prior intent with `current: null` also returns unavailable, preventing recreation when an applied/deleted outcome is already known. A deleted intent never becomes a new current record through this policy.

For a matching applied key, compare canonical public semantic request fields before fresh-write revision/chronology checks. Target IDs, complete declaration, correction precondition and reason participate. Object key ordering and UUID letter case do not change the canonical request. Authored note/label/reason, exact evidence reference and accepted occurrence representation remain part of declared provenance; changing their source values, including an offset representation, conflicts under the same intent (`manual_intent_conflict`). Server retry recording time and server-generated record log UUID are excluded from the original browser declaration.

An exact replay returns the original receipt plus the **current** head, `replayed: true` and `appendEvent: null`. It never rewinds a corrected declaration, recipient, high-water or revision. An old record replay after recipient correction retains the original receipt's old recipient while returning the head's corrected person. A past record/correction replay can therefore succeed despite an old public expected revision or a newly supplied retry clock older than the current high-water; no fresh event is admitted. It does not return an old snapshot. Different actors/actions cannot select that receipt by reusing only its UUID. A genuinely distinct action with no prior lookup is evaluated as a fresh command under its own key.

Fresh writes use target conflict before correction revision conflict. Record against an existing head returns `manual_log_exists`; correction without a head returns `manual_log_missing`. Fresh project/log mismatch returns `manual_target_conflict`; stale correction returns `manual_revision_conflict`. Person changes are explicit corrected recipient data, subject to later native old/new contact authority. A fresh recording time before head high-water returns `manual_time_conflict`; equal instants are permitted and preserve source strings. Revision exhaustion returns `manual_revision_exhausted`. Failed writes leave input state unchanged and return no receipt or append descriptor. These cases passed the selected unit run after observed red.

## Protected references and real service gates

Notes, reasons, declarations, applied intent request copies, receipts and append descriptors are protected data. Conversation/evidence URLs may contain bearer or invitation tokens. Syntax acceptance proves neither harmlessness nor disclosure authority. No routine logs/diagnostics, automatic outbound/public projection, remote preview or URI resolution may expose them. Rendering must eventually treat authored text as escaped plain data and separately qualify actual native UI behavior.

The actual service must enforce current native session/CSRF/capabilities, project/person/log visibility and relationship, and privacy restrictions before producing private context or returning any result. It must atomically bind the actor/action/intent key, head mutation, append event and retained receipt; prove uniqueness and race/recovery behavior on real PostgreSQL; preserve exact supported instant strings/precision through storage; and retain historical corrections without capped/truncated policy input. An original record retry must resolve the scoped original outcome/head before treating a regenerated server UUID as new creation. None of that service, storage, full-history loader, disclosure projection or Privacy inventory/lifecycle integration is implemented here. A body UUID is not an authorization grant.

## Current source qualification and remaining gates

The current 47-file candidate passed 390 tests in 16 files, feature-local TypeScript, Biome on 47 files and unchanged-rule type-aware ESLint on 44 TypeScript files after formatting/import-order fixes. All seven process groups from that finite sequential batch were empty and the window was released. Minimum observed free space was 20,368,809,984 bytes. Source hashes, exact commands and terminal receipts are indexed in `qualification-manual-20261101.json`.

The shared reason boundary also has a genuine format-only supplied-reason red (1 failed/28 passed), followed by 29/29 selected green and inclusion in the final 390-case run. Optional empty reasons remain allowed at the syntax boundary; native transition policy still requires reasons where applicable. Visible Persian joiners remain preserved.

The original manual-only reproduction is:

```sh
PATH="$PWD/.runtime/bin:$PATH" bun run test:unit src/features/agency-projects/communication/manualCommunication.test.ts src/features/agency-projects/communication/manualCommunicationPolicy.test.ts --maxWorkers=1
```

The source checks establish no authorized database loader, transaction, persisted/full history, actual uniqueness, native/auth workflow, Privacy lifecycle or full application acceptance. Those remain required gates. Further static/native/heavy work requires the current coordinated resource policy; this source-check window is complete and released.

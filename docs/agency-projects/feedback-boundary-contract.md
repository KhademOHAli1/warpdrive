# Feedback declaration boundary, proposed AP-06.1 contract

1 November 2026. Status: **outside-source test draft prepared, NOT RUN; production import absent**. Only `/Users/ali/Documents/Codex/2026-10-31/warpdrive-agency-projects-implementation/work/feedbackRecord.test.ts.draft` and this document are owned by this preparation. No source, qualification, runner, static, build, database, provider or commit action is included. The current 52-file candidate remains unchanged. An exact recovery copy is retained at `test-preparation/feedbackRecord.test.ts.txt`, outside executable source.

The immutable baseline AP-06.1 calls for bounded text/reference feedback scoped to a canonical project, deliverable and identified external version, with provenance. Its dependencies remain AP-02.3 and AP-08.1. T13 additionally requires safe text handling, multiple reviewers/contradictions, hidden-source denial and later deduplicated change-request conversion. This proposal covers a narrow parsing boundary only. It does not close that workflow or its runtime acceptance.

## Small recommended API

- `parseFeedbackDeclaration(unknown)` returns actual `Result<FeedbackDeclaration, "invalid_feedback_declaration">`.
- `parseFeedbackCommand(unknown)` returns actual `Result<RecordedFeedbackCommand, "invalid_feedback_command">`.

The future `./feedbackRecord` module is absent. Production implementation must follow root review, actual observed missing-module red and meaningful assertion red. Future types should be inferred from strict feature-local Zod schemas. Existing reusable boundaries are `canonicalUuidSchema` and exact-preserving `referenceSchema` in `valueSchemas.ts`, `exactInstantSchema` in `instantSchema.ts`, and `communicationChannelSchema` plus `plainTextSchema` in `communication/communicationValueSchemas.ts`. No shared helper changes or new shared API are proposed.

## Declaration is one attributed claim

The public-shaped declaration contains only:

| Field | Proposed bounded meaning |
| --- | --- |
| `projectId`, `deliverableId` | Canonical UUIDs, lowercase after existing UUID normalization. Syntax does not prove their relationship or current visibility. |
| `workVersionReference` | Required exact external work-version reference, at most 2,048 UTF-16 units through the existing reference boundary. No URL normalization, asset fetch or substitution of a newer version. |
| `author` | Strict tagged `internal-user` with `userId`, or `external-contact` with global `personId`. No name/address matching, copied contact identity, workspace account creation or authenticated-client implication. |
| `source` | Required strict object with explicit existing communication `channel`; optional exact protected `evidenceReference`, at most 2,048 units. The existing channel variants are email, phone, WhatsApp, meeting and other with a substantive single-line label up to 80 units. |
| `text` | Substantive multiline authored plain data, proposed maximum 2,000 UTF-16 units. Preserve accepted source whitespace, Farsi/German content and embedded Persian joiners. Reject unsafe controls and text that is blank after the existing check-only Cf removal. |

The selected author is an attribution claim, not the person who necessarily typed the CRM record. The source channel says where the staff-recorded feedback is attributed to have come from; it establishes no provider event, authenticated sender, delivery or signature. Optional evidence remains absent when not supplied. The parser does not invent evidence or make absence proof of source availability. A URL may contain bearer/invitation tokens even when syntactically accepted.

There is no source-occurrence timestamp in this smallest proposal. The later native recording time must not be displayed as the author's actual writing/sending time. If source occurrence is needed, its known/unknown semantics require explicit review rather than substituting server time.

One declaration has one author, version and text. Multiple reviewers and contradictory text remain separate declarations; no merge, majority, resolution, approval, requested-work task, included-round accounting or commercial inference follows parsing. This boundary accepts no history/batch arrays and imposes no retained-history or correction-count cap.

## Native command is separate from browser data

A private server-assembled command wraps one validated `declaration` with canonical new `feedbackId`, fixed `provenance: staff-recorded`, canonical `recordedByUserId` and exact offset-qualified `recordedAt`. The actual instant boundary supports at most nine fractional digits and preserves the accepted offset/fraction string. It does not silently round or create a current clock value.

The native recorder may differ from an internal author or the selected external contact. Browser declarations reject native IDs/time/provenance, approval/signature/authority flags, provider certainty, commercial fields and growing collections. Parsing a UUID or a fixed provenance string does not establish that the server supplied it. Actual server assembly, session identity and author selection must be enforced by the future native request path; neither parser is an authority function or a browser DTO projector.

No writer, receipt, current head, expected revision, mutation intent, durable replay, history appender or lifecycle transition is introduced here. Repeated parser calls are not a deduplication guarantee. Future recording/correction and change-request conversion must use owner-accepted transactional identity/replay and retained provenance. This draft does not invent that contract or borrow the manual-communication policy as a new feedback engine.

## Rendering and protected-content limits

The existing plain-text boundary does not sanitize HTML or prove safe rendering. Literal angle-bracket text can be preserved as authored data; the draft explicitly tests this without treating it as markup. No `dangerouslySetInnerHTML`, renderer, sanitizer or asset preview is proposed. Actual escaped/native rendering of malicious text, safe link presentation, FA/DE/EN/RTL accessibility and browser diagnostics remain unimplemented and unqualified. Parser tests cannot establish XSS closure or satisfy all baseline malicious-HTML acceptance.

Text, evidence/version references and author/recorder identities are protected project context. No routine telemetry, logs, diagnostics, automatic outbound/public projection or remote fetch may expose raw content. Syntax acceptance is neither harmlessness nor disclosure authority. Retention, correction/redaction, deleted-source handling, historical attribution and third-party disclosure require Privacy and native owner review. No permanent immutable plaintext history or automatic export is asserted.

## Current native scope and other unresolved decisions

1. An authorized native loader/request path must prove current project/deliverable ownership, the exact identified work-version relationship, selected author's actual internal-user/contact identity and eligibility, and every applicable CRM/project scope ceiling. The parsers cannot detect a syntactically valid cross-project link, removed source, inaccessible author or revoked reviewer. These checks must fail closed before recording or disclosure, with no source-existence oracle.
2. Owners must accept the attribution/source vocabulary, optional evidence and proposed 2,000-unit text bound. The global contact remains distinct from an internal user and from the native recorder; a contact is never authenticated by selection. Unattributed/unknown authors are unavailable in this draft rather than inferred from recorder or email address.
3. Source-occurrence time, corrections, withdrawal and exact work-version lifecycle remain future explicit contracts. New content must not silently relabel old feedback. No current-scope or retained-history guarantee follows parsing.
4. A future writer needs accepted stable intent/uniqueness, native transaction authority, historical retention/replay and Privacy rules before it can persist anything. AP-06.2 change-request conversion, AP-06.3 revision scope and AP-06.4/5 review decisions remain separate capabilities with their original dependencies.
5. Rendering/link safety and actual hidden-source denial require native/UI and real repository tests. No source-only validation should be described as safe rendering, external authentication, client signature or full T13 acceptance.

## Test-first status

All draft cases are **NOT RUN** and remain outside `src`. They describe malformed/strict input rejection, canonical IDs, exact work/evidence references, tagged authors, explicit source channels, protected text bounds, separate native metadata and contradictory declarations without merging. No observed red, green, static, database, browser, native-language or runtime result exists for this slice. No production module is present through this handoff.

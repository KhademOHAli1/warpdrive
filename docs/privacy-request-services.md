# Authenticated request and initial assignment services

These services use the existing local privacy schema. They do not create HTTP endpoints, register routes, provision a reviewer, activate processing policy, deliver data or qualify an installation. Complete FA/DE/EN personal and administrative screens remain required by DPL-11/12.

`createOwnPrivacyCase(db, actor, input, signal)` accepts only intake key, case kind, locale and encrypted summary. The native authenticated actor supplies the subject, in-app recipient and requester identity. An ordinary active, accepted, verified user with current fresh authentication can request its own data without any privacy-review capability. The service grants no global or case-review authority and records no verification until the separate self-verification command succeeds. A supplied subject, recipient or requester field is rejected.

`readOwnPrivacyCase(db, actor, {caseId}, signal)` returns only that requester's case identifier, kind, status, version, receipt and due date. Unknown cases, operator-only cases and another requester's cases return the same `not_found`. Encrypted summaries, reviewer notes, candidates, decisions and matched records are absent. The HTTP layer must establish the internal actor from a real credential and add the appropriate origin/CSRF and abuse controls before these services are exposed.

Intake is serialized by the current account/MCP/session lock order. The logical key is scoped to the creator and a domain-bound HMAC of the canonical own-intake command. Concurrent retries create one case/event. A changed command or collision with a different intake operation conflicts. Replays return the immutable original intake receipt, while a fresh status read returns current state.

## Explicit initial assignment

`case.assign` is an explicit global triage capability. It is the only added exception, alongside `case.intake`, to the prohibition on using case capabilities without a case scope. It conveys no matched-record disclosure or ordinary CRM writer authority. Native administrator status and global `case.review` alone confer no assignment capability.

`listPrivacyIntakeQueue` requires current `case.assign` authority. It returns at most 100 minimal case summaries, ordered by UUID with a validated `afterId`, and marks the view `live_unassigned`. A refresh is needed for new lower-sorted IDs. The list has no intake contents, subject matches or count-based existence shortcut. Only received/verification-needed cases with no historical review assignment are eligible.

`claimPrivacyCase` also requires the actor's current global `authority.manage` and `case.review`. It creates the first reviewer membership for one eligible case. Its case capabilities are the intersection with that actor's already-held global capabilities; `case.assign` and `policy.manage` are never copied into case membership. No client-provided grant list is accepted. Assignment, case-version advance and minimal immutable event commit together under the native authority and case-row locks.

A prior assignment event or any current/historical non-intake membership makes a case ineligible for a new global claim. Revocation does not reopen a takeover path. Subsequent delegation uses the existing case-specific management service; recovery after all case managers are removed needs a separately reviewed recovery procedure. Replaying an earlier claim cannot restore a revoked membership or bypass revoked global authority. Claim receipts are historical command outcomes, not a replacement for current case status.

Assignment changes the case command version, never the subject identity scope, recipient or verification generations. A current self-verification proof therefore remains bound to the same subject after initial assignment. Sensitive review/export operations still recheck their own case capability and current proof.

## Current discovery-job observation

`getDiscoveryJobStatus(db, actor, {caseId, jobId}, signal)` returns only ID, case ID, discovery kind, validated durable status, attempts and update time. It uses the existing current native session/global `case.review`/case-membership transaction before querying an exact case/job/kind match. Wrong-case, unknown and other-kind jobs share `not_found` within an authorized case; absent case authority returns `forbidden`. Malformed input returns `invalid_input`, recognized storage failures return `storage_unavailable`, and cancellation stays rejection.

This read uses the current reviewer's authority rather than an originating worker ticket. It can describe work needing attention after the worker's session or subject binding changes. It does not disclose encrypted result contents, claim tokens, originating sessions or authority generations, and cannot renew worker authority, mutate state, repair a lease or retry work. Enqueue receipts remain immutable historical `queued` outcomes. No HTTP action, job-status screen, new store or generic execution is added.

All 15 reader regressions passed against real PostgreSQL in the selected four-file campaign on 1 November 2026. The separate readiness-parser cases deliberately failed in that command; its overall nonzero result is not aggregate source qualification. Detailed collection, assertion RED, isolated statics, inventory and publication boundaries remain in the implementation register.

## Development evidence and remaining gates

The first service tests failed because the modules were absent. A later real PostgreSQL regression demonstrated that a new claim could reactivate authority after revocation; eligibility was corrected to retain the historical assignment barrier. On 31 October 2026 at 18:00:42 Europe/Berlin, the personal, assignment and existing authority regression selection passed 27 tests in four files against disposable migrated PostgreSQL. Scoped source lint passed. This evidence is separate from the green CI of published commit `65a579e`, which predates these services.

First-reviewer installation provisioning, HTTP credentials/origin/abuse tests, minimal case access review, localized forms and actual browser journeys remain open. No rights deadline, policy activation, public external-intake channel, complete export, erasure or installed acceptance is inferred from a received request or an initial assignment.

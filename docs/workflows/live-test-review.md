# Published live-test review

This is a bounded increment toward WF-025 and issue #682. It adds an explicit review to the existing published-version live-test dialog. Simulation keeps its existing published-version behavior. Draft simulation, synthetic trigger input, full per-step testing acceptance and the other WF-025 dependencies remain separate work.

## Review and display

The live dialog reads the existing authorized workflow and exact published-version queries with dialog-local fresh-read options. A fetching, failed, placeholder or mismatched read cannot supply an actionable review. The workflow must be active and its current capability response must allow running; server authorization remains authoritative.

The review identifies the selected deal and publication by their existing display names and publication number. Its effect projection contains only counts of configured manual starts, record reads, tasks, conditions and waits. A configured step count is not an executed path or a promised number of writes. A reached read can reference a deal other than the selected trigger deal. A reached live task can create a real activity; a reached wait can defer later effects. Current task metadata, activity-create permission and referenced-record access remain server checks.

Authored step names, task contents, bindings, condition operands, custom-field identities, graph identifiers and layout are omitted from the projection. Unsupported handler profiles and malformed or excessive definitions produce an unavailable review. Static structural readiness does not establish runtime authority or successful execution.

Live confirmation requires explicit acknowledgement of the displayed workflow, selected record, mode and exact publication. Observed changes, including a publication that changes and later returns, invalidate acknowledgement. A renewed review requires a new explicit acknowledgement.

## Submission and replay

The new live UI always supplies `reviewedVersionId` with its command. Admission validates that optional UUID through the existing strict input schema. Under the existing workflow row lock, a genuinely new request must match the current publication before insertion. A stale review returns the existing bounded conflict result without creating a run.

The compatibility field is optional for existing callers; this increment does not require review evidence on every possible live API admission. Omitted fields preserve existing live and simulation consumers and the default simulation mode.

An existing request key is checked against its original record, mode and, when supplied, original pinned version before returning that run. The newly current publication is not substituted into a response-lost retry. Existing active/archive, authorization and current-publication readiness gates remain before replay; a paused or currently denied workflow can therefore still refuse a replay.

The dialog freezes the complete first submitted command and its displayed context. Returned failures and transport rejection keep the same request key, record, mode and reviewed publication for retry. Changing observed metadata or caller props cannot silently rebind that command. The picker stays disabled after submission, and an in-flight submission cannot be duplicated. Acknowledgement of admission continues through the existing caller callback; it does not mean execution has completed. CSRF is read separately for each attempt.

## Evidence and limits

The original-main dialog regression collected 22 cases: four simulation/in-flight controls passed and 18 review, freshness, identity or replay assertions failed. These are direct behavior assertions, retained for the implementation. The additive deferred-reload case then reproduced 22 passed cases and one failed newer-publication reload assertion before the generation fence. All 74 current focused cases now pass across the dialog (23), pure projection (33) and existing acknowledgement (18) files; formatting and the selected syntactic cognitive-complexity rule pass on all eight affected TypeScript files. The local wrapper's private compiler-cache artifact cap failed after those phases completed; the failure is preserved separately, and a read-only recovery receipt verifies the actual phase exits, unchanged source/dependencies and empty owned process group. This is not an overall wrapper pass. The transport/query hooks and action are fixtures; dialog, locale and picker behavior use the real components. Pure projection cases cover supported and unsupported definitions, omissions and work bounds. PostgreSQL integration cases cover admission, stale-review refusal, response-loss replay, compatibility, authority and both publication/admission lock orders.

Focused execution, hosted type checking, full typed lint, aggregate suites and actual PostgreSQL results must be recorded separately. The initial regression used a bounded local unit run; database, whole-app type-aware checks and builds remain hosted gates. Existing browser smoke does not exercise this review. Native live-review UI, human accessibility and effect-language review, complete WF-025 acceptance, included-main qualification, release and deployment remain open.

Existing authorized query caches still retain workflow and publication payloads. The review and submitted command are temporary client state; hiding a view does not erase cached bytes or establish a retention policy. The change adds no RPC, database migration, provider action or execution permission.

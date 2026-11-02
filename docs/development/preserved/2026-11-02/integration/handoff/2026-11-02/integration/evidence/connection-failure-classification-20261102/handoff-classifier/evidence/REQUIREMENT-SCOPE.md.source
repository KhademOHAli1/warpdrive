# CONN-014 requirement scope, 2 November 2026

**Conclusion: actual Slack read classification already supplies meaningful CONN-014 evidence. It is not merely a generic error model. The recorded acceptance does not expressly require UI propagation, persistent health, every future provider, or a live-provider campaign.** A claim of complete current-provider classification still needs the applicable failures in the remaining actual Slack operation paths addressed or explicitly bounded; the read slice alone is not evidence for exchange, sending or revocation.

This is a bounded requirements clarification, not task closure, another programme audit or a new execution. Only this file was written. No application source, tracker, refs/index, peer output, tests, compiler, database, CI, network or service was changed or run. The explorer's current-source observations and Root's official-source review are accepted as supplied evidence; their transport audit was not repeated.

## Actual normative clauses

| Source | Recorded requirement and its scope |
| --- | --- |
| Live GitHub issue137, as freshly read by Root | OPEN, AC1 exactly: “Distinguish revoked authorization, insufficient scope, missing resource, rate limit, transient outage and invalid configuration.” Blocking dependency001. No added UI, all-verbs, provider-count or provider-live AC was reported. GitHub owns live status. |
| Canonical `docs/integration-execution/tasks.csv:53` | Same six distinctions. Verification is **provider contract**, stage **local**, owner Platform + integrations, ARCH local-foundation, dependency CONN-001. This is a classification obligation, not an explicit health/UI/remote-operation criterion. |
| Accepted CONN-002, `tasks.csv:41`; `provider-contract-qualification.md:11-24` | Contracts cover authorize, exchange, refresh, list resources, check, disconnect and capability discovery. Each supported handler has Result/required AbortSignal; unsupported methods remain explicit. Finite failures, bounded retry hints and effect certainty are preserved. Crucially, an actual protocol implementation must **prove its classifications**; a rejection code asserts definite no effect, while uncertain mutation failures retain unknown outcome. |
| Accepted CONN-001, `provider-seams.md:13-20,40-54` | Identifies OAuth, resource reads, I/O/errors, health and removal as actual provider seams; adaptation is incremental. It specifically says to preserve callback/role/resource/deny-first revoke protections and not call extraction complete while the old throwing/cancellation path remains. This is the agreed extraction direction, not an amendment saying all extraction must be completed inside014. |
| Accepted ARCH-005, `architecture-identities-authority.md:344-353,358-364,375-392` | Stable reasons support future lifecycle decisions. Permanent refresh denial, transient outage/rate limit, missing configuration/resource, key failure and failed remote revocation have different meanings. These clauses constrain the truth of classification; they do not implement the state machine or assign its entire runtime to014. |
| `provider-contract-qualification.md:68-73` | Actual Slack adaptation was explicitly not established by the original generic contract fixture. The **CONN package** exit additionally needs remaining lifecycle/credential/ownership work and two providers exercising it. That package exit is not a two-provider or live-provider gate for individual014. |

The live issue observation is attributed to Root; this review did not poll GitHub. Original CSV and accepted design clauses establish requirement history, not a substitute live status authority.

## Credit the existing Slack read implementation accurately

Root's [source observation](SOURCE-OBSERVATION.json) pins six tracked Main/private paths and the existing `824ae85` implementation plus `5bf5563` typed-lint amendment. `slack-read-qualification.md:33-75` records the actual `auth.test` / `conversations.list` path delegating to the Result-returning read helper, with distinct stable reasons alongside existing ProviderFailure codes:

|014 distinction|Existing read evidence|
|---|---|
|Revoked authorization|Allowlisted specific observations such as `token_revoked` / `account_inactive`, distinguished from ambiguous `invalid_auth`.|
|Insufficient scope|`missing_scope` reason, separate from general permission denial.|
|Missing resource|`channel_not_found` decoder classification; explicitly not a selected-channel probe or proof that these two read methods return it.|
|Rate limit|HTTP429 / allowlisted rate-limit response, bounded validated retry hint.|
|Transient outage|HTTP5xx / allowlisted service-unavailable response and safe transport failures.|
|Invalid configuration|Allowlisted invalid-arguments/configuration reason, distinct from missing-resource despite sharing the broader `invalid_input` code.|

The tracked qualification records23 classification,12 cancellation and4 legacy controls, **39 unique local cases**, followed by scoped types/lint and later Main qualification (`slack-read-qualification.md:7-15,150-169`; `qualification-20261101.md:18-23`). Those counts are not added to later encompassing suites. The current read implementation therefore corrects the older inference that only a generic model existed. Generic `ProviderFailure.code` alone cannot reveal every distinction: the actual read-specific stable reason supplies additional information.

This is implemented transport/decoder behavior under local controlled responses, not an actual Slack installation/request or a new provider-live claim. No extra live-provider gate is inferred from the generic acceptance checklist.

## Required breadth: OAuth, revoke and other transports

**There is no literal “all seven operations for all providers” clause in014.** CONN-002 establishes the seven-slot contract, including explicit unsupported slots; it does not require every provider to implement every slot. Likewise,014 does not turn every existing network function across the repository into this task's immediate ownership.

**Nevertheless, the actual provider-failure obligation is not textually restricted to the two read methods.** Under the accepted contract, an implementation cannot claim provider-wide normalized classification while silently flattening applicable failures at its other supported provider protocol boundaries. The remaining coarse Slack OAuth exchange, `chat.postMessage` and `auth.revoke` paths are explicitly outside the existing read adaptation (`slack-read-qualification.md:73-75`). They are the concrete uncovered actual-Slack classification surface, not hypothetical future providers.

For a complete current-Slack014 claim, provide a small operation-to-failure matrix and meaningful local protocol/transport tests showing applicable distinctions there. It need not force all six reasons onto every method: “not returned/applicable for this operation” and a safe finite unclassified fallback are valid boundaries. Do not misdiagnose an authorization-code rejection as revoked user authority merely to fill a six-column table. Preserve already-invalid-token revoke success; classify an actual failure without turning an idempotent success into an error.

That is an interpretation of the unqualified014 acceptance **together with** the accepted actual-protocol classification clause, not a fabricated additional live AC. A bounded read-only increment may record partial evidence now. Whole-row closure should identify which actual provider operations it covers, rather than imply the generic runner or read decoder already covers those coarse paths.

Other provider/domain transports require an explicit applicability/ownership mapping, not an indiscriminate rewrite. `provider-seams.md:24-35` assigns active MAIL transport/endpoint/lifecycle work to its owner and rejects a competing registry/store. This review finds no clause requiring014 to implement future providers, borrow dirty MAIL work, duplicate Gmail/IMAP/SMTP policy, or complete all seven adapters before its six classifications can be accepted. If a broad “shared production provider layer” claim includes those transports, its owner must account for their relevant classification boundary; current Slack evidence cannot be relabeled as their proof.

## UI propagation is not expressly014

The current reason reaches `AppError.context`, while server actions collapse it to `requestFailed` (trusted source observation). That limits current consumer/UI behavior, but it does **not** erase the actual provider-level read classifications or independently establish a violation of014's literal provider-contract criterion.

The recorded division of work is explicit:

- CONN-013 (`tasks.csv:52`): persist attempt/success timestamps, normalized error, degradation reason and next retry separately.
- CONN-015 (`:54`): reauthorization workflow, preserving account/settings and reviewing scopes, with UI/integration verification.
- CONN-017/018 (`:56-57`): immediate local block plus durable remote-revocation retries/operator state.
- CONN-020 (`:59`): redacted per-connection audit outcomes/correlation.
- CONN-021 (`:60`): reusable actions with safe error translation, authorization and timeouts.
- CONN-022 (`:61`): common management UI across identity, health, scopes, resource selection, reconnect, pause and removal, with FA/DE/EN browser verification.
- UX-003/004/006 and `ux-flows-patterns-copy.md:75-78`: reviewed recovery patterns/copy, including cause, what is saved/blocked, who can act and the next step. These are accepted design constraints and later runtime/localization obligations, not a new014 browser acceptance requirement.

The partial qualification's paragraph `slack-read-qualification.md:137-148` lists UI, health, cancellation and adapter work still absent. It is an honest slice boundary; it should not be read as silently appending every listed item to014's unchanged AC. Actual action translation is separate from a future UX expectation. Preserve safe bounded reason information at the provider contract without exposing raw provider errors/secrets; do not require client rendering or health DDL merely to prove six internal distinctions.

## Concrete remaining014 evidence, and what is not needed

1. Preserve the actual six-way read reason coverage and its redaction/legacy-ID controls. Do not replace it with a coarser generic enum or lose missing-resource versus configuration distinction.
2. Account for the applicable coarse **current Slack exchange/send/revoke failures** in the operation matrix and actual transport/decoder tests before claiming complete current-provider classification. An unused synthetic generic failure envelope is insufficient under `provider-contract-qualification.md:19-24`. This does not require a complete seven-operation migration, missing-provider methods, automatic retries or lifecycle implementation.
3. Keep protocol facts honest. Root's [official-source constraints](PRIMARY-SOURCES.md) distinguish `invalid_auth` from proved revocation, resource unavailable/access denied from definite deletion, provider JSON `request_timeout` from an elapsed transport deadline, and mutation `internal_error`/`fatal_error` from a definite no-effect rejection. Rate limits are method/workspace-specific; a bounded retry hint is not a scheduled retry or stored health observation. Do not reuse read-only classification to assert safe replay after an uncertain send/revoke outcome.
4. A decoder's missing-resource support does not require adding `conversations.info` or pretending a selected-channel check ran. Selected-resource storage/authorization is CONN-007 (`tasks.csv:46`), and Slack channel refresh/removal semantics are SLK-005 (`:90`). A documented failure from an already-supported actual method can be classified locally without introducing that probe.
5. Local provider-contract verification is the recorded014 gate. UI rendering, persisted health, two-provider package exit, browser acceptance, production deployment or live Slack credentials/calls are not newly imposed by this clarification. Any later increment still needs its own applicable source/qualification evidence and normal owner acceptance; this note does not close issue137 or change its dependency001.

There is therefore real existing progress, plus a concrete unadapted current-Slack classification surface. Neither “generic model only” nor “all future UI/lifecycle/provider runtime must be completed for014” accurately states the recorded requirement.

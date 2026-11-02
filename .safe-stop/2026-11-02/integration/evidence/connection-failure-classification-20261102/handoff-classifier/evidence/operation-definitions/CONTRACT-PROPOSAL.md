# Proposed Slack operation failure detail, NOT EXECUTED

This is a test-first candidate for the existing exchange/send/revoke wrappers under CONN-014.
It is not a shared contract already accepted by Main and adds no acceptance gate to the
separately frozen revocation-confirmation increment. No production code changed.

## One server-only additive context

Propose `AppError.context.slackOperationFailure = { reason, providerFailure }` for non-read
operations only. Use the existing finite read-reason vocabulary and existing ProviderFailure
shape, preserving the distinction between stable reason and broader code. Do not add raw
provider codes/messages, request bodies, credentials, URLs, headers or transport causes to
the context. Current server-action public errors remain unchanged; this is not a new UI DTO.
`slackReadFailure` and all existing read behavior remain unchanged.

Explicit rejection mappings exercised: send token_revoked -> authorization_revoked /
authorization_expired; send missing_scope -> insufficient_scope / forbidden; send
channel_not_found -> missing_resource / invalid_input; exchange bad_client_secret ->
invalid_configuration / invalid_input; revoke invalid_auth -> permission_denied / forbidden.
Missing resource means unavailable to the current operation, not proved deletion. Invalid
authentication is not proved revocation. Authorization-code rejection is not repurposed as
a revoked-authority example merely to populate the table.

HTTP429 retains rate_limited and only integer Retry-After seconds in1..86400, normalized
to milliseconds. That bound is the existing local ProviderFailure/read policy, not a new
Slack promise. Omit invalid/out-of-bound hints; do not parse an error body or auto-retry.
For send/exchange/revoke internal_error, fatal_error, HTTP503 and transport failure, retain
transient_outage / unavailable with outcome:unknown. Unrecognized provider errors use
unclassified / failed / unknown; malformed/unreadable replies use invalid_response /
invalid_response / unknown. A successful OAuth candidate lacking the required scope keeps
the existing SLACK_SCOPE_MISSING ID and reason insufficient_scope, but uses invalid_response
with unknown outcome: the remote token may already exist, so forbidden/no-effect would be
incorrect there. A provider JSON request_timeout remains finite unclassified/failed/unknown
until a separate allowlist mapping is reviewed; it is not treated as an elapsed transport
deadline. The explicit rejection codes omit outcome under the existing
contract's no-effect meaning. Unknown effect is never downgraded to a safe replay.

Keep existing JSON/request IDs/messages: SLACK_REQUEST_FAILED for send/revoke provider
errors, SLACK_RATE_LIMITED for their429, SLACK_UNAVAILABLE for their503. Exchange retains
SLACK_EXCHANGE_FAILED throughout. Previously raw send/revoke transport errors would gain
a safe AppError using the existing SLACK_UNAVAILABLE identity; exchange transport uses its
existing exchange-failed identity. No new public error ID or API signature is proposed.
Already token_revoked and explicit revoked:true revoke results remain successful.

## Exact test scope and existing companion expectation

The new file defines18 Vitest cases:5 explicit operation/reason cases,1 bounded429 case,
9 operation-by-fault cases,1 finite fallback case and2 revoke success controls. Some cases
contain bounded response vectors: both partial provider errors, five retry hints per
operation, four fallback shapes per operation and an under-scoped successful exchange
candidate. Counts must not be presented as18 total HTTP invocations.
Every fetch is a total controlled replacement passed through the actual existing wrappers;
no nonexistent helper is imported, no global fetch/env changes or live calls are made.
Requests assert the fixed method target and exactly one attempt. Failure redaction checks
precede detailed assertions and do not print hostile credential/body fixtures on RED.
Expected current2fe behavior is16 assertion RED/2success controls, not an observed result.
The anticipated RED is absent detail or raw transport/parser error, not import/setup failure.

One future companion must be explicit: the existing slackReadFailures.test.ts test named
"does not apply read classifications or no-effect claims to a mutating request" currently
expects empty context for send/internal_error. If Main accepts the additive operation
context, amend that guard atomically to require no slackReadFailure and the safe unknown
operation detail, preserving its original no-read/no-no-effect intent. It is untouched now.
The current confirmation unit cases assert legacy IDs/successes; their contract is preserved,
and none of the eleven frozen native6 inputs was edited. No health/UI/DDL/lifecycle/provider
or full CONN-014 closure is asserted. Root will review and take the concrete shared contract
to Main once before implementation and will run actual RED only under the applicable lane.

## Official sources, checked read-only 2026-11-02

- [oauth.v2.access](https://docs.slack.dev/reference/methods/oauth.v2.access/):
  bad_client_secret identifies invalid client configuration. Both partial-error descriptions
  allow prior success, so an exchange error cannot establish that no credential was created.
- [chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage/):
  channel_not_found can reflect inability to enter a DM. Both internal/fatal errors may
  follow partial success, so a send is not declared unsent or safely replayable.
- [auth.revoke](https://docs.slack.dev/reference/methods/auth.revoke/):
  invalid_auth can be credential or IP-policy denial; partial-error descriptions permit
  uncertainty. Explicit revoked:true remains confirmation; token revocation is not uninstall.
- [rate limits](https://docs.slack.dev/apis/web-api/rate-limits/):429 carries Retry-After
  in seconds, scoped to the applicable method/workspace. A retained hint is not a scheduled
  retry, persisted health or a declaration that every workspace/method is unavailable.

The proposed local normalization and effect rules are inferences constrained by these
protocol descriptions and the existing accepted provider contract; they are not a claim
that the current wrappers already implement them. Only official documentation was fetched.

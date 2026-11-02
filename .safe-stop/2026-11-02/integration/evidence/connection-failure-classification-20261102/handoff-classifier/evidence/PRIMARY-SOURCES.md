# Slack failure classification: primary-source constraints

Read 2 November 2026 through the official Slack developer documentation. This is
read-only evidence for a future CONN-014 source increment, not an implemented adapter,
provider call, test result or task completion. Existing refresh15 inputs remain frozen.

## Preserve uncertainty rather than invent a stronger diagnosis

Slack documents `invalid_auth` as either invalid credentials or a disallowed source IP.
It therefore cannot alone prove revocation. `token_revoked` and `token_expired` provide
more specific authorization observations. A successful `auth.test` checks authentication
and identity and requires no scope; it cannot establish permission for every operation.
[Slack auth.test](https://docs.slack.dev/reference/methods/auth.test/)

Slack documents `missing_scope` as missing required scope permission. Its
`channel_not_found` result also occurs when an app cannot enter the intended DM, so a
resource-unavailable classification must not tell users that the resource was definitely
deleted. Keep scope and resource-access observations distinct. The same page warns that
`internal_error` or `fatal_error` can follow a partially successful operation; a send
failure must preserve uncertain effects and must not become an automatically safe replay.
Slack's JSON `request_timeout` describes missing or truncated POST data; it must not be
blindly treated as a transport timeout. These are constraints on a future mapping, not a
claim that the current adapter already preserves them.
[Slack chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage/)

Conversation metadata depends on the requested conversation and token permissions.
The documented failure envelope uses `ok:false` plus an error string. Callers must check
the envelope even when transport succeeds; a positive HTTP response alone is insufficient.
[Slack conversations.info](https://docs.slack.dev/reference/methods/conversations.info/)

## Rate-limit observations are method/workspace-specific

Slack's HTTP APIs signal throttling with429 and a Retry-After header expressed in seconds.
The described restriction is scoped to the method and workspace. Other methods or
workspaces may remain usable. A future normalized failure should retain a validated
bounded retry hint without inventing a workspace-wide outage, blocking sleep, automatic
retry, persistent next-retry observation or completed health-storage capability.
[Slack rate limits](https://docs.slack.dev/apis/web-api/rate-limits/)

## Next code-boundary review

Map these facts to the existing production Slack transport and current provider-failure
DTO before proposing a shared contract change. Prove actual adapter response handling
with meaningful local contract tests; generic catalog tests and a synthetic failure
envelope alone do not satisfy CONN-014. Separate observation storage requires its own
CONN-013 design, migration reservation and native state-integration evidence. No DDL,
application source or acceptance tracker was changed by this note.

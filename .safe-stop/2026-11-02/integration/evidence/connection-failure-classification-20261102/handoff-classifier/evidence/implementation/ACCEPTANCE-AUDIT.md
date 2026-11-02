# CONN-014 original local criterion audit

The live issue137 snapshot records one AC: distinguish revoked authorization, insufficient scope, missing resource, rate limit, transient outage and invalid configuration. The original verification is provider contract. A separate source/acceptance audit found the complete six-distinction local criterion covered for the current integration-owned Slack protocol operations by actual wrapper tests, rather than by ProviderFailure type definitions alone.

| Required distinction | Actual passing protocol evidence |
| --- | --- |
| Revoked authorization | Read token_revoked and send token_revoked produce authorization_revoked. |
| Insufficient scope | Read/send missing_scope; an unusable successful exchange preserves insufficient_scope with unknown effects. |
| Missing resource | Actual send channel_not_found produces missing_resource, replacing the older decoder-only evidence limitation. |
| Rate limit | Read boundary and send/exchange/revoke HTTP429; bounded Retry-After hints are exercised. |
| Transient outage | Read failures and all three operation paths under internal/fatal errors, HTTP503 and transport rejection. |
| Invalid configuration | Read invalid_arguments and actual exchange bad_client_secret produce invalid_configuration. |

The refined log records93/93 passing cases across five files, including47 operation vectors and23 read cases. Current reviewed hashes match the actual refined receipt: Slack8585d466, helper6d841bb5, operation definitions8bbbfcc9 and read companion3d2ed3d7. Thirty distinct registry checks passed across two unchanged-source invocations, and the current private inventory has empty missing/invalid lists.

The current transport entrypoints are authorize URL construction, exchange, two reads, send and revoke. There is no additional production refresh/capability transport in this feature requiring invented coverage. MAIL-owned Gmail transports and future vendors are outside this Slack evidence. No UI/health/retry/browser or live-provider gate is added to this six-distinction local criterion.

Adjacent limit: listSlackChannels still parses apparently successful channel payloads with Zod directly. A malformed success payload can escape as a raw ZodError. This limits any claim that every possible failure is normalized. It does not negate the six recorded distinctions or create an extra CONN-014 acceptance gate. This remains a separate improvement candidate.

The source5 classifier candidate is private. Main must reconcile it with the confirmation parent, run configured types/typed lint/current privacy inventory and adopted exact-source CI, publish the source and record the applicable local AC against that actual revision. Native6 confirmation evidence remains exclusively on the frozen2fe parent. No GitHub status, task count, release, deployment, installation or goal completion is changed by this audit.

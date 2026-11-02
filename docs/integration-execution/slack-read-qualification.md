# Partial Slack read failure qualification

1 November 2026. **Partial CONN-014 source and focused unit evidence; CONN-014 stays
planned.** This record does not close provider adaptation, health, actions/UI, MAIL,
EVT, migrations, actual-provider or release acceptance.

**Final focused unit evidence: 39 unique passing cases.** The timer-only baseline could
return late success after synchronous work/microtasks, before its overdue callback ran.
Root observed four deterministic monotonic-clock failures and eight passing controls
on the actual helper, then authorized the absolute-deadline fix. Root observed the
updated cancellation file pass 12/12, then reran classification 23/23 and legacy 4/4
on that final source. Independent source recheck confirmed the identified deadline
path is closed and caller abort retains precedence. Later scoped types/lint passed
as recorded below; broader regression gates remain pending. Synchronous CPU
preemption is not claimed.

The comparison base is `994cecd20a6e56afe4866022c6d2d765ac23af0a`; final owned source
is identified by the fingerprints below. Root ran the finite test windows centrally. The author
ran no test campaign, compiler, lint, database, install, build, browser or service.
Existing Biome formatting only was applied to the five owned files. No task register,
action/UI, MAIL, migration or shared provider schema changed in this slice.

## Source and behavior

| Owned path                                                | SHA-256 of reviewed final source                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/features/integrations/slack.ts`                      | `4eaa308d24fed9d8a1069d3afcfb1ed4d50d3cfebc2da8554cb678823e21dba5` |
| `src/features/integrations/slackRead.ts`                  | `83aabc1dfcfeb076684951ca6da6a378091ff3db18a7aab0940f189f212ca36a` |
| `src/features/integrations/slackReadFailure.ts`           | `fdf59462107754c7a767bb98e7261086dbb823e05a8454b1bdb2a276cae02ff4` |
| `src/features/integrations/slackReadFailures.test.ts`     | `db62abf24ffc360d63cc4063e06ae0e0e20b40dfaa9f485f97aa188df510dff3` |
| `src/features/integrations/slackReadCancellation.test.ts` | `db02c8d2183ddd0f78fe28f04e3ab1daafeb8ab63b0d75c4c09449d132949c71` |

The existing `slackRequest` delegates only `auth.test` and `conversations.list` to the
new Result-returning `requestSlackRead` (`slack.ts:35`). Existing callers retain their
signatures and legacy error IDs. The helper requires a real caller `AbortSignal`
(`slackRead.ts:14`), forwards an owned cancellation signal to fetch, and applies a
fixed 10-second deadline (`:9`). It races the entire fetch/body operation (`:89`),
aborts on caller cancellation/deadline, observes late promise rejection, and removes
its timer/listener in `finally`. A late response is abort-checked before JSON reading
(`:42`, `:44`); caller cancellation propagates rather than becoming an outage Result.
These checks bound asynchronous waiting, not synchronous parser/CPU preemption.
The review correction additionally captures one absolute `performance.now()` deadline,
checks caller abort first, then checks elapsed time before I/O, after fetch/body/decoder
completion and after race settlement before returning. A timer callback is no longer
the sole way to recognize an overdue completion. Root's updated 12-case cancellation
selection passed, and independent review confirmed the elapsed-time path is closed.

`SlackReadFailure` keeps a finite reason beside the existing `ProviderFailure`, with
a finite internal legacy error ID (`slackReadFailure.ts:6`). The legacy wrapper removes
that internal ID before exposing context (`slack.ts:44`). No new provider-schema fields
or arbitrary provider error strings are passed through. Provider and HTTP failures
retain their previous `SLACK_REQUEST_FAILED`, `SLACK_RATE_LIMITED` or
`SLACK_UNAVAILABLE` identity; newly normalized network failures use the existing
unavailable identity.

| CONN-014 distinction                   | Allowlisted example                 | Existing ProviderFailure code |
| -------------------------------------- | ----------------------------------- | ----------------------------- |
| Revoked authorization                  | `token_revoked`, `account_inactive` | `authorization_expired`       |
| Insufficient scope                     | `missing_scope`                     | `forbidden`                   |
| Missing resource, decoder-only support | `channel_not_found`                 | `invalid_input`               |
| Rate limit                             | HTTP 429 or `ratelimited`           | `rate_limited`                |
| Transient outage                       | HTTP 5xx or `service_unavailable`   | `unavailable`                 |
| Invalid configuration                  | `invalid_arguments`                 | `invalid_input`               |

The decoder also has finite expired-authorization, permission-denied, invalid-response
and unclassified fallbacks. `invalid_auth` can mean invalid credentials or an IP-policy
denial, so it is not classified as proof of revocation. Unknown/malformed provider
errors, unreadable JSON and fetch rejection contents are redacted. HTTP 429/5xx bodies
are not parsed for classification. Only integer Retry-After seconds from 1 through
86,400 produce `retryAfterMs`; invalid, fractional, nonpositive or excessive values
are omitted. This observes a delay; it schedules no retry.

The mutating `chat.postMessage`, `auth.revoke` and code-exchange paths were not adapted.
Revoke's existing already-invalid-token success remains intact. Read failure categories
must not be used as a new no-effect assertion or retry policy for mutations.

## Test-first evidence and final unique count

Private evidence directory: `/tmp/warpdrive-integration-program-private/`.
Each named `.log` has a matching `.json` runner record with process group, terminal
exit code, duration and disk observations. JSON runner records are not Vitest reports.

| Stage                                                                   | Evidence stem, suffix `-20261101` | Process group | Terminal result                                                                               |
| ----------------------------------------------------------------------- | --------------------------------- | ------------- | --------------------------------------------------------------------------------------------- |
| Behavioral red through existing `slackRequest`, before production edits | `slack-read-failures-red`         | 81296         | Exit 1, 21 failed and 2 existing-behavior controls passed, 23 total; 0.834 s runner duration. |
| Classification baseline green                                           | `slack-read-failures-green`       | 82444         | Exit 0, 23/23; 0.853 s.                                                                       |
| Cancellation red against the actual normalized helper baseline          | `slack-read-cancellation-red`     | 83065         | Exit 1, 3 failed and 3 controls passed, 6 total; 0.864 s.                                     |
| Cancellation green after minimum race/cleanup fix                       | `slack-read-cancellation-green`   | 84020         | Exit 0, 6/6; 0.855 s.                                                                         |
| Final read-failure regression green                                     | `slack-read-failures-final`       | 84029         | Exit 0, 23/23; 0.416 s.                                                                       |
| Existing Slack transport controls                                       | `slack-legacy-controls`           | 84034         | Exit 0, 4/4; 0.433 s.                                                                         |
| Monotonic deadline red on actual helper, without firing timers          | `slack-monotonic-red`             | 86783         | Exit 1, 4 overdue-phase failures and 8 controls passed, 12 total; 0.640 s.                    |
| Monotonic deadline green after absolute checks                          | `slack-monotonic-green`           | 87650         | Exit 0, 12/12; 0.533 s.                                                                       |
| Final-source classification rerun after monotonic correction            | `slack-final-classification`      | 88255         | Exit 0, 23/23; 0.541 s.                                                                       |
| Final-source legacy rerun after monotonic correction                    | `slack-final-legacy`              | 88261         | Exit 0, 4/4; 0.528 s.                                                                         |

The meaningful cancellation reds were noncooperative-fetch deadline, response-body
abort settlement and caller cancellation while fetch ignored its signal. Their controlled
promises were released in cleanup; this was not a missing-import red or a long hanging
test. The three passing baseline controls covered pre-abort/no I/O, cooperative signal
forwarding and successful cleanup.

**Earlier unique green checkpoint: 33 passing cases across three files**, consisting of 23
read-failure cases, six cancellation cases and four existing `slack.test.ts` cases.
Repeated baseline/final greens are not added to that count. These are synthetic-fetch
unit cases, not native Slack protocol or actual account conformance.

The updated cancellation file adds four monotonic fetch/body/decoder/settlement cases
and two simultaneous-overdue caller-abort controls. Its 12 cases passed on the correction.
The retained classification 23/23 and legacy 4/4 selections then passed on the final
source. **Final unique passing count is 39 across the same three files**, not a sum
of repeated runs. All three observed red stages remain recorded above.

Exact finite unit selections, run separately by root using pinned Bun 1.4.4:

```text
/tmp/warpdrive-bun144/bin/bun run test:unit src/features/integrations/slackReadFailures.test.ts --maxWorkers=1
/tmp/warpdrive-bun144/bin/bun run test:unit src/features/integrations/slackReadCancellation.test.ts --maxWorkers=1
/tmp/warpdrive-bun144/bin/bun run test:unit src/features/integrations/slack.test.ts --maxWorkers=1
```

## Primary-source and acceptance boundaries

Official documentation was checked on 1 November 2026:

- [auth.test](https://docs.slack.dev/reference/methods/auth.test/) and
  [conversations.list](https://docs.slack.dev/reference/methods/conversations.list/)
  describe the currently wired read methods and documented error codes. Their tables
  permit unexpected additional errors; unrecognized codes remain a finite fallback.
- [Slack rate limits](https://docs.slack.dev/apis/web-api/rate-limits/) defines HTTP 429
  with Retry-After seconds. The local existing ProviderFailure limit additionally bounds
  the represented delay to one day.
- [conversations.info](https://docs.slack.dev/reference/methods/conversations.info/)
  documents `channel_not_found`. That method was not added. Its fixture demonstrates
  generic decoder-only missing-resource support, not that `auth.test` or
  `conversations.list` checks a selected channel or returns that code in practice.

The full task acceptance is broader than this slice. Action/UI errors still collapse
to `requestFailed`; normalized observations are not stored as health or lifecycle.
No actual provider adapter was adopted, and the complete typed seven-operation adapter
and production caller cancellation propagation are not implemented here. In particular,
the unchanged legacy `slackRequest` signature constructs its own signal (`slack.ts:41`);
the required-signal helper does not make current actions/jobs cancel end to end.

No retry, lifecycle transition, credential/grant/proof store, resource authorization,
queue, sender or MAIL behavior was added. No live Slack request, native provider
qualification, browser acceptance or provider availability claim follows from these
units. No response-size or paging overhaul was included. Independent source review
accepted this bounded slice after the deadline correction. CONN-014 stays planned.

## Later scoped static qualification

Source `5bf5563` resolves typed lint by using the owned abort signal's state for
deadline cancellation, preserving caller-abort precedence, and removing unnecessary
async mock declarations. Final selected reruns again passed 12 cancellation cases
(group 4363), 23 classification cases (5685) and four legacy controls (5691), with
matching `slack-static-*-20261101.log/json` receipts. These are the same 39 cases,
not additional tests. Current standalone TypeScript, scoped Biome and type-aware
ESLint passed; see [the focused record](qualification-20261101.md). The later checkpoint
below adds full-unit and build results. Full-PG, whole-lint, browser and provider/action/health
acceptance remain separate.

## Later qualification checkpoint

The [1 November D225 checkpoint](qualification-20261101.md) subsequently completed the
full 6,024-case unit lane, production/worker compilation and independent frozen dependency
install. D225 whole-source lint stopped at Biome before ESLint; the subsequent docs-only
`d238bcb` full-lint recheck passed. Its exact receipts and remaining
full-PG, browser/runtime, authority and provider gates are separate from this focused record.
This later evidence does not rewrite earlier red/interruption results or close broader tasks.

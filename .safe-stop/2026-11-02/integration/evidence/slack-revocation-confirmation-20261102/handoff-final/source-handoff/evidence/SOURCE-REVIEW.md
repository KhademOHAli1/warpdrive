# Slack revoke confirmation, bounded source/protocol review

Reviewed 2026-11-02T03:43:35.665701+00:00. **No blocking source/protocol finding in this minimal patch.** This is acceptance of the stated response boundary, not closure of CONN-014/017/018 or installed/provider qualification.

## Exact scope

Private source root: `/Users/ali/Developer/warpdrive-integrations`.

- Baseline `baseline-slack.ts`: `4eaa308d24fed9d8a1069d3afcfb1ed4d50d3cfebc2da8554cb678823e21dba5`. The retained red receipt records Main `a7df229f33e6e47216e4e2ba3b132d9ffcfa6846` and this preimage; this review did not query Git or CI.
- Reviewed `src/features/integrations/slack.ts`: `2fece3be197eb962310615034ddcefccbf3cd204a57e2870b2cb2cc532b8c0a2`.
- Unit definition `src/features/integrations/slackRevocation.test.ts`: `491e6dec299c57cd0891441192ac8eec6fa439520979295c628564a20e9d76e3`.
- The source diff consists only of the dedicated response union at lines8–14 and selection/idempotent handling at lines77–81. Method allowlist, request endpoint/options, HTTP error mapping, read delegation, chat response boundary and OAuth code exchange are unchanged.

## Confirmation and current-token semantics

| Response | Current result | Assessment |
| --- | --- | --- |
| `ok:true, revoked:true` | Original success object returned | Explicit confirmation required. |
| `ok:true, revoked:false` | Legacy `SLACK_REQUEST_FAILED` | Does not report unconfirmed revocation. |
| `ok:true` without the flag | Same legacy failure | Does not mistake generic success for confirmation. |
| `ok:false, error:invalid_auth` | Same legacy failure | Ambiguous authentication denial retains retry material. |
| `ok:false` with `token_revoked`, `token_expired` or `account_inactive` | Synthetic `{ok:true}` | Preserves existing idempotent handling of an explicitly unusable current token. It does not prove this call revoked an entire app installation, all tokens or an upstream refresh grant. |
| Other error/malformed response shape | Legacy failure | No new permissive fallback. |

[Slack's official auth.revoke reference](https://docs.slack.dev/reference/methods/auth.revoke/) says the `revoked` boolean reports actual revocation, `invalid_auth` may reflect an IP restriction, and the three retained error reasons describe an expired token or deleted user/workspace/app context. It also distinguishes token revocation from uninstalling the application. The disconnect caller supplies no testing-mode body, so the documented optional dry-run argument is not enabled by this path. This supports the narrowed confirmation rule and the limited current-token interpretation above. No live provider call was made.

## Existing caller and disclosure boundary

[service.ts](/Users/ali/Developer/warpdrive-integrations/src/features/integrations/service.ts:183) loads the credential through the current active-admin gate, writes `revocation-pending` **before** the revoke I/O, and returns `false` on a thrown provider failure (lines183–201). The credential-clearing/disconnected-event transaction is reached only after accepted confirmation, with an admin recheck (lines202–212). Ordinary credential consumers require `connected` (lines151–180). These are source facts; the separately prepared six real-PG assertions have not been executed in the evidence reviewed here.

New rejection paths retain `SLACK_REQUEST_FAILED`, the fixed `slack_request_failed` message and empty context, without attaching the provider response, credential or headers (slack.ts:77–81). The already-invalid success remains only `{ok:true}`. No new public DTO, schema, persisted field, provider URL, permission or lifecycle capability is introduced. [actions.ts](/Users/ali/Developer/warpdrive-integrations/src/features/integrations/actions.ts:22) continues its existing CSRF/fresh-session wrapper and bounded public error response; the disconnect action returns the existing boolean result. This is not a new blanket error-redaction or cancellation claim.

## Evidence and manual Privacy binding

Retained `unit-red.log` shows the three intended ambiguous/false/missing-confirmation failures with four controls passing. `unit-green.log` shows 46 passes across the new7, existing4, read-classification23 and cancellation12. `focused-green.receipt.json` records the exact reviewed source/test hashes, successful two-file Biome and affected-unit invocation, and no DB/provider calls. These are existing actual receipts, not tests executed by this review.

The unmodified inventory diagnostic has empty missing/invalid and2350 source files, but the retained `slack-discovery-observation.json` has no discovered items for this file. This is explained by [registryBoundaryDiscovery.ts](/Users/ali/Developer/warpdrive-integrations/src/features/privacy/registryBoundaryDiscovery.ts:101), which recognizes an identifier literally named `fetch`, while this transport calls `fetcher`; [registryDiscovery.ts](/Users/ali/Developer/warpdrive-integrations/src/features/privacy/registryDiscovery.ts:119) adds automatic source-review hashes only for discovered/config boundaries. [registry.ts](/Users/ali/Developer/warpdrive-integrations/src/features/privacy/registry.ts:15) checks discovered coverage and declaration shape, rather than rehashing every otherwise-unreached manual declaration.

Therefore CLI PASS alone did not justify a stale manual hash. The existing [registryIdsSales1.ts](/Users/ali/Developer/warpdrive-integrations/src/features/privacy/registryIdsSales1.ts:4) binding was observed first at baseline4eaa and, after Root's owned update during this review, at the exact reviewed2fe hash. Updating only that pre-existing digest is justified by this bounded source review; no new IDs or capability-status changes are warranted. The existing [registry.test.ts](/Users/ali/Developer/warpdrive-integrations/src/features/privacy/registry.test.ts:37) independently rehashes every declared source-review binding; no claim of a fresh run of that test is made here. The diagnostic remains source inventory, not installed proof or permission to redesign global discovery.

Only this new `SOURCE-REVIEW.md` was written. No repository source, registry, ref/index, tracker, peer output or frozen MCP packet was edited; no tests, DB, compiler, services or CI ran. The sole network read was the cited official protocol reference.

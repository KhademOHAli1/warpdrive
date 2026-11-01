# CONN-001: provider seams and extraction order

Reviewed on 31 October 2026 against application source `3d653a7`, plus the current
registry extraction working diff. This source inventory identifies seams; it does not
close credential, refresh, grant, migration or live-provider implementation tasks.

## Existing provider-specific assumptions

| Boundary         | Current behavior and evidence                                                                                                                                                        | Incremental extraction                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Directory        | `catalog.ts` defines 21 provider IDs and delivery kinds. Only MCP/Gmail/Slack are implemented locally.                                                                               | Keep stable IDs and existing copy; one registry supplies auth types, local asset, copy key and implementation availability. Planned entries expose no implemented auth type.                          |
| Presentation     | `IntegrationCard.tsx`, `IntegrationDetails.tsx`, `IntegrationMark.tsx`, `connectionState.ts`. Details choose MCP/Gmail/Slack surfaces by delivery kind.                              | Read common metadata from the registry. Keep provider-owned flows and current shell. Extract common state only after authoritative lifecycle transitions exist.                                       |
| Configuration    | `slack.ts:8-23` reads Slack client configuration and builds a fixed Slack URL/scope set.                                                                                             | Provider contract receives server configuration through a typed, server-only adapter boundary. Never pass client secrets in registry metadata or serialized UI DTOs.                                  |
| OAuth attempt    | `service.ts:28-126`, callback `src/app/api/integrations/slack/callback/route.ts`. Attempt is single-use and bound to user/session; callback rechecks admin after exchange.           | Preserve these protections while moving transport behind authorize/exchange contracts. Common handshake ownership must retain the provider, installation, actor and session binding.                  |
| Account identity | `service.ts:96-118` upserts by provider/account; reconnect also replaces owner. `schema/integrations.ts:36-38` enforces global provider/account uniqueness.                          | Preserve UUIDs/history on migration. Separate upstream identity, connection owner, grant and credential version. Do not silently transfer custody on another admin's reconnect.                       |
| Credentials      | `service.ts:91`, `146-175` use email crypto and load encrypted JSON token; caller receives decrypted token internally.                                                               | Reuse encryption and isolate credential access in a server broker. Contract/public DTOs carry opaque IDs; no new credential store beside active mail work.                                            |
| Resources        | `slack.ts:101-125` fetches joined public channels, bounded to 20 pages. `actions.ts:63-84` revalidates selection then stores channel ID/name. Schema settings are Slack-shaped JSON. | Typed resource IDs/display names/cursors with selected-resource authorization. Keep paging bounds. General settings need an additive migration, preserving Slack fields and selected channel history. |
| I/O/error        | `slack.ts:25-98` validates provider responses and uses fixed 10-second timeouts, but throws and does not accept caller cancellation.                                                 | New contract requires Result and caller AbortSignal for every I/O method. Adapt legacy Slack code test-first; do not imply old functions already conform.                                             |
| Health           | `actions.ts:88-100` invokes auth.test and records lastCheckedAt.                                                                                                                     | Separate credential validity, permission change, selected-resource availability and delivery health, with safe structured errors.                                                                     |
| Removal          | `service.ts:178-214` blocks ordinary access before remote revoke; failure retains encrypted material in revocation-pending.                                                          | Preserve local deny-first behavior and history. Add bounded durable revoke recovery through current pg-boss; no generic new queue.                                                                    |
| Authorization    | `actions.ts:22-38` requires CSRF/fresh native session; `service.ts:19-25` requires active admin.                                                                                     | Reuse current actor/CRM evaluator, then intersect connection/grant/app/resource authority. Do not relax shared Slack management by treating owner UUID alone as permission.                           |
| Audit            | `integration_events` records connection actions, not durable CRM mutation intents.                                                                                                   | Retain lifecycle history and introduce the event outbox separately at canonical CRM transaction boundaries.                                                                                           |

## Peer ownership and migration boundary

On this review the mail peer remains on committed `8539fe8`, with 120 modified and
234 untracked paths. Its `src/features/connections/` currently owns endpoint/DNS/TLS
policy and its email domain owns provider-neutral mailbox identities, proofs, transports,
credential/lifecycle/offboarding work. These are active changes, not a reviewable complete
adoption. No code or migration is copied from that dirty tree.

Common provider contracts live initially under `src/features/integrations/providers/`.
They describe typed method boundaries and capability discovery, not a competing
connection store, endpoint resolver, queue or mailbox domain. Before storage extraction,
review an immutable mail handoff and agree the one shared owner/contract. The existing
integration 0083 and workflow 0084 chain is preserved; the mail peer has its own unmerged
0083 through 0088 allocations. Do not independently allocate another competing migration
or renumber a peer installation's historical ledger.

## Implementation order and acceptance evidence

1. Define identities/authority/lifecycle and event semantics in ARCH. Validate negative
   ownership/grant/resource/reconnect and failure scenarios before runtime claims.
2. CONN-002 defines typed authorize, exchange, refresh, resource listing, check,
   disconnect and capability-discovery boundaries. A bounded invocation helper and
   deterministic contract fixtures must demonstrate cancellation, unsupported methods,
   operational Result errors and no accidental network/credential use. These fixtures
   are explicitly local and do not establish actual provider support.
3. CONN-003 centralizes metadata while preserving all 21 cards, asset geometry, translated
   descriptions and existing connection decisions. Red tests must catch absent metadata
   and bypassed asset selection, then pass alongside FA/DE/EN catalog and existing UI tests.
4. Adapt current Slack transport/service incrementally to the contract, preserving callback,
   role, resource validation and deny-first revoke tests. Do not mark extraction complete
   while old throwing/cancellation behavior remains on its production path.
5. Reconcile mail storage and migrate identities/credentials/settings with actual PostgreSQL
   upgrade/restore evidence. Then add refresh/health/selection/repair ownership cases, using
   one provider registry and common credential lifecycle rather than independent engines.

CONN-001 verification is source review of all catalog/schema/action/callback/transport
seams above and the explicit extraction sequence. No additional provider cards, grants,
external calls, shared-schema mutation or public exposure were introduced by this inventory.

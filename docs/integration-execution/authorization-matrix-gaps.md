# QA-005: authorization coverage preparation and gaps

Source review at `bc40519b4f8f7147f6232897c26450bb8c478816`, 31 October 2026.
QA-005 acceptance is: "Test current role, record visibility, grant scope, app
role, offboarding and direct endpoint/tool access." Its verification is security
regression (`docs/integration-execution/tasks.csv:422`). This document inventories relevant code/tests and proposes the next
bounded slice. It does not execute or close that acceptance.

No tests, PostgreSQL campaign, typecheck or build were run for this preparation.
The owning execution campaign records current pass/fail evidence separately.
Existing test names below are source coverage, not newly inherited runtime proof.
The inventory is targeted rather than a claim to audit every CRM endpoint.

## 1. Actual authority path

| Boundary | Current implementation | Coverage implication |
| --- | --- | --- |
| Native browser/tRPC context | `createContext` resolves a live session and calls `hydrateActor`; `protectedProcedure` requires non-null session/actor (`src/server/trpc/context.ts:22-32`, `trpc.ts:9-14`). The route passes this context to the real router (`src/app/api/trpc/[trpc]/route.ts:18-29`). | A caller-created test context is not evidence that invalid cookies are rejected by this route. Native session policy and domain permission checks are separate boundaries. |
| Current CRM actor | `hydrateActor` loads current activity, admin status, one permission set, visibility memberships and the guarded managed-team set (`src/server/hydrateActor.ts:20-73`). | Fresh hydration handles current role/state. A previously returned actor object is still a snapshot. |
| Domain permission | `can` denies inactive before admin bypass, then record visibility and action flags; `canSee` includes the restricted-pipeline gate. SQL visibility has a parity contract (`src/features/permissions/can.ts:35-64`, `canSee.ts:5-40`, `sql.ts:36-80`). | Preserve these authorities and their SQL/pure parity. Grant/app checks must intersect them rather than replace them. |
| MCP token authentication | `verifyAccessToken` verifies signature/issuer/MCP audience and current token-row revocation/expiry. `authenticateMcp` then hydrates the subject (`src/features/oauth/tokens.ts:62-106`; `src/features/mcp/auth.ts:16-40`). | A new authenticated HTTP request checks current token and actor state. This does not prove a second check immediately before every effect within an already authenticated request. |
| MCP request/tool context | HTTP authentication stores one request-local context; tool registration closes over it (`src/features/mcp/http.ts:16-36`). `getToolActor` reads that snapshot and checks only null (`src/features/mcp/tools/types.ts:50-53`). | Current-role/visibility changes between authentication and invocation need explicit negative cases. A synthetic `mcp:<actor>` session ID is not a native session credential (`src/features/mcp/actorContext.ts:25-30`). |
| MCP read/write dispatch | Reads call existing tRPC/domain reads; writes call existing domain mutation services (`src/features/mcp/tools/reads.ts:40-68`, `writes-deals.ts:33-66`). | Test direct tool invocation and the shared mutation service; neither UI hiding nor annotations enforce authority. |
| Mail ownership/privacy | `assertMailboxOwner` denies missing/foreign accounts alike; `canSeeEmail` keeps private threads owner-only, with no admin content bypass (`src/features/email/mailboxOwnership.ts:73-86`, `emailVisibility.ts:20-55`). | General CRM admin bypass cannot become private-mail read permission. Active-caller validation is supplied by the request/job boundary; the owner fast path is not itself an active-user lookup. |
| Existing workflow executor | Admission and each advancement rehydrate the actor and use `canWorkflow` (`src/features/workflows/runAdmission.ts:27-41`, `execution.ts:17-54`). | Reuse this existing engine. Workflow user flags are not an installed application's role or a client grant. |

`updateDeal` illustrates the current snapshot boundary: the supplied actor drives
the visibility-group check and `loadEditableDeal` before the write transaction;
the transaction later uses that actor for reference checks
(`src/features/deals/dealUpdate.ts:84-127`). `loadEditableDeal` reads current deal
and pipeline data but evaluates the supplied actor
(`src/features/deals/dealAuth.ts:50-96`). This is a source-observed test seam, not
an executed proof of a particular exploit or race in this preparation.

## 2. Six acceptance dimensions

| QA-005 dimension | Existing relevant tests | Remaining gap/status |
| --- | --- | --- |
| Current role | `permissions/can.test.ts:51-109` covers no flags, own/team/any variants, inactive-before-admin and missing records. `server/hydrateActor.integration.test.ts:43-58` checks team-view grant hydration. `deals/dealUpdatePerms.test.ts:39-59` covers missing edit grant/foreign owner. | Partial existing coverage. Add authority changes after a server-produced actor snapshot is captured, plus consistent request/tool/shared-service denial. Include a positive control so a broken fixture or stale CAS cannot make every negative pass. |
| Record visibility | `permissions/canSee.test.ts:25-182`, `permissions/sql.test.ts:181-230` and `deals/visibility.test.ts:33-237` cover owner/group/additive/pipeline/inactive/dead-session behavior. MCP `writes.test.ts:87` denies a hidden lead; `writes-ownerOverride.test.ts:35-82` prevents echo of newly hidden created records. | Partial. Maintain per-operation assertions for list/search/count/detail/mutation/reference links and for visibility narrowing between checks and effects. Generic visibility tests do not qualify every tool or reply projection. |
| Grant scope | OAuth code/PKCE, audience, refresh, revocation and policy-lock tests exist in `features/oauth` and `features/auth/management`. | The fine-grained CRM grant runtime is absent, not merely missing test assertions. Current access/refresh/code tables have client/user/token bindings but no persisted capability selection (`src/db/schema/oauth.ts:10-54`). Cannot claim read-only grant enforcement. |
| App role | Domain and workflow role checks exist. ARCH selected an intersection with installation/app roles. | No installation/app-role ceiling is carried by the inspected `AppContext`, OAuth schema or MCP actor adapters. The selected SDK/app-role intersection is not implemented here. Domain admin/member or `workflow.*` tests cannot close this dimension. |
| Offboarding | `auth/management/offboarding.integration.test.ts:67-112` checks local session/MCP/code revocation, Gmail credential removal and no resurrection after reactivation. `mcpPolicy.integration.test.ts:73-97` checks MFA-policy and admin-promotion sweeps. | Partial. Add same-token direct HTTP/tool denial after offboarding/reactivation, stale in-flight context, and queued-effect authority checks. Shared Slack custodian pause/transfer remains absent; do not invent it in tests. |
| Direct endpoint/tool access | MCP HTTP tests cover unauthenticated challenges plus authenticated protocol clients, isolation, denied writes and next-request revoke. Tool tests invoke handlers directly. Domain/router tests cover many lower-level permissions. | Partial. Extend consistent negative matrices across native route, MCP transport and direct tool/service calls. Do not label a hand-built `createCaller` context or a hidden UI control as public-route authentication evidence. |

## 3. Existing direct MCP coverage is broader than the older BASE snapshot

`src/features/mcp/http.test.ts:32-131` exercises both the legacy and pinned
`2026-07-28` SDK protocol profiles through the actual authenticated handler with
real PostgreSQL state. Its assertions include:

- Both clients list the current 35 tools; own private deal reads succeed and the
  other actor's private deal is denied (`http.test.ts:86-101`).
- A regular actor without create permission gets a tool error and no deal named
  by the denied request is inserted (`http.test.ts:102-116`).
- Revoking the first token's actual row causes the same client's next tool-list
  request to fail (`http.test.ts:118-125`).

The transport injects `fetch` into the in-process Request handler
(`http.test.ts:66-72`). This is useful SDK/handler protocol and real-DB coverage,
not an actual network socket, TLS deployment, real ChatGPT/Claude installation or
browser onboarding qualification.

The current MCP scope behavior remains broad: authentication emits `scopes: []`
(`src/features/mcp/auth.ts:34-40`), both read and write groups are registered
(`server.ts:9-12`), and read-only/destructive annotations are descriptive
(`tools/types.ts:76-91`). A regular actor's denied write proves current CRM
permission enforcement, not a separate client scope restriction. An admin's
client does not currently gain a persisted read-only ceiling from this code.

The fake provider's exact requested-scope tests simulate upstream provider scopes.
They do not create CRM grant scopes, an app role or server enforcement in MCP.
Similarly, the typed provider contract says that callers evaluate authority first
(`src/features/integrations/providers/contract.ts:25-30`); it exports no such
enforcement service. The architectural evaluator/broker/lifecycle/outbox decisions
must not be presented as already exported runtime APIs.

## 4. Mail and offboarding boundaries to preserve with the mail owner

The current interactive send action checks CSRF, resolves a trusted actor and
checks mailbox ownership before refreshing credentials
(`src/features/email/actions.ts:45-94`). Its send domain repeats the ownership
check (`src/features/email/send.ts:101-119`). Existing tests include:

- Owner, foreign-owner and nonexistent mailbox results in
  `src/features/email/mailboxOwnership.test.ts:23-55`.
- Foreign mailbox send rejection in `src/features/email/send.test.ts:47`.
- Private thread hidden from another user and even a non-owner administrator;
  shared thread readable only via a visible linked record and kept out of the
  colleague's personal Inbox in `emailReadsVisibility.test.ts:29-119`.
- Foreign draft update/delete denial in
  `src/features/mcp/tools/writes-email.test.ts:244-284`.

These policies must remain stronger than generic CRM record admin access. A
different actor ID, account ID or administrator flag supplied in a request must
never substitute for trusted caller identity. Actual delayed-send/offboarding
cases and independent multi-account mail changes belong to the mail owner; this
document proposes no replacement mailbox model, credential broker, worker or queue.

Current offboarding revokes sessions, MCP tokens/codes, invitations and pending
auth mail; it disconnects Gmail locally and queues remote Google revocation
(`src/features/auth/management/offboarding.ts:11-48`). It does not sweep Slack
`integration_connections`. `withSlackConnection` rechecks the calling active admin
but not the recorded connection owner's activity
(`src/features/integrations/service.ts:19-25`, `146-175`). Thus the ARCH shared
custodian pause/transfer policy is still implementation work. Remote revocation
queue insertion is not proof that an actual provider accepted revocation.

MCP issuance/revocation already shares `lockMcpGrants`
(`src/features/auth/management/mcpGrants.ts:5-21`; `oauth/consent.ts:13-17`;
`oauth/exchange.ts:35-43`). Preserve those transaction/lock contracts. They cover
credential issuance sweeps; they do not add a grant capability ceiling or prove
authorization is rechecked at every later tool effect.

## 5. Negative matrix backlog

"Runnable next" means supported by current runtime/fixtures and suitable for an
authorized test-first batch after the frozen campaign. "Foundation required"
means an assertion must wait for real local implementation rather than invent a
scope/app-role field or a fake service. None of these rows was executed here.

| ID | Case and required observation | Next status/ownership |
| --- | --- | --- |
| AUTHZ-01 | Native member with missing edit permission calls the actual mutation boundary directly: deny, unchanged target, no change log/realtime side effect. Include an allowed member control. | Runnable next, shared deal authority. |
| AUTHZ-02 | Capture a valid actor; remove its permission-set edit flag before invoking the shared deal update and direct MCP update tool. Deny using current role, not the captured flag set. | Runnable next, recommended slice below. |
| AUTHZ-03 | Capture a valid actor; deactivate it before invocation. No mutation/data exposure, even if the old object still says active/admin. Reactivation must not revive a revoked token. | Runnable next; separate actor freshness from token revocation assertions. |
| AUTHZ-04 | Remove visibility-group/team membership or move a deal into a restricted pipeline before read/update. Check detail, list/search/count and references for no hidden fields or existence leak. | Runnable domain/tool subcases; maintain SQL/pure parity. |
| AUTHZ-05 | Revoke an actual token and call `tools/call`, not only `tools/list`, on the same protocol client. Offboard/reactivate its subject and prove the old token stays unusable. | Runnable MCP HTTP extension with real token rows. |
| AUTHZ-06 | Revoke/deactivate after HTTP authentication but before its tool effect using a deterministic barrier. Deny at the selected authorization checkpoint; state what happens if the effect already committed. | Runnable adversarial experiment; current request snapshot is a likely missing checkpoint, not an executed finding here. |
| AUTHZ-07 | Read-only/minimal client grant attempts a write directly, with an actor who otherwise has write authority, including an admin actor. No mutation; tool visibility alone is insufficient. | Foundation required: real persisted AISEC capability model and server checks. |
| AUTHZ-08 | Write allowed by grant but denied by app role, disabled installation or selected resource; reverse combinations cannot widen rights. | Foundation required: SDK/installation role enforcement and CONN resource policy. |
| AUTHZ-09 | Foreign and nonexistent mailbox IDs produce equivalent denial before decrypt/refresh; admin cannot read private mail; a foreign direct draft mutation cannot change a row. | Preserve/extend existing MAIL/MCP tests with mail owner; do not replace them. |
| AUTHZ-10 | Offboard/role-change/revoke between scheduling and external mail/provider effect. No new attempt when authority is already lost; an in-flight ambiguous outcome is not falsely claimed recalled. | Coordinate peer MAIL and future provider jobs; reuse existing executor/pg-boss. |
| AUTHZ-11 | Offboard a shared Slack custodian; another admin cannot silently resume old automation without the selected transfer/reauthorization policy. | Foundation required: shared-custodian lifecycle/delegation implementation. Current any-active-admin rule is different. |
| AUTHZ-12 | Rich-view/embedded action calls the same operation with forged IDs/capabilities or a stale grant. Enforce the same data projection and mutation policy as text/direct calls. | Foundation required where an embedded action/runtime does not exist; no synthetic pass. |

Existing workflow source provides a useful integration-test pattern to reuse later:
`executionSafety.integration.test.ts:77-104` downgrades authority and hides a deal,
then expects a failed run, no hidden title in output and zero created activities.
The executor rehydrates each advancement. This does not qualify every planned
provider node, a new event engine or a future app role.

## 6. Recommended next bounded shared-authority slice

Select current-role freshness for the existing `updateDeal` path first. It is
shared with MCP `update_deal` and already uses `loadEditableDeal`, `can`,
`canSee`, reference checks, a transaction and compare-and-swap. No provider
credential, public endpoint, new migration, mail rewrite or new event/lifecycle
service is needed for this local slice.

1. Use `createIntegrationPlatformFixtures` in a fresh real PostgreSQL database.
   Keep its allowed member/visible deal as the positive control. Retain a
   server-hydrated actor, then change only the database permission-set flag or
   user activity before calling the existing mutation/tool.
2. Observe a meaningful red for stale captured authority. Keep the deal's valid
   `expectedUpdatedAt` unchanged when changing authority, so a stale CAS, broken
   fixture or invalid input cannot masquerade as the expected permission denial.
3. Reuse `hydrateActor` and the existing domain checks at the mutation's selected
   transaction checkpoint. Use the refreshed actor consistently for the edit,
   visibility-group and linked-record checks; refreshing only one check while
   later checks reuse the old actor is incomplete.
4. Verify zero target changes, change-log entries and mutation notifications on
   denial, plus the preserved success control and hidden-record error shape.
   Exercise the shared service and direct MCP tool registration separately.
   A server-produced stale test context is different from an externally supplied
   forged identity; label that boundary accurately.
5. Retain/extend current MCP HTTP tests to show that the next request sees the
   new role/offboarding state. A deterministic within-request revocation test
   should then select and prove its checkpoint explicitly. If token-row identity
   must be retained internally for that checkpoint, use actual verification facts
   already returned by `verifyAccessToken`, not a fabricated grant/scope object.

This first slice would close selected role/visibility regressions for one existing
operation. It would not establish read-only MCP grants, all tools, app roles,
transaction-wide revocation serialization or exactly-once external effects.
Implement actual capability persistence/consent in AISEC and the app-role ceiling
in its owning runtime before attempting to close those matrix dimensions.

## 7. Fixture reuse and closure boundary

The new native fixture paths already supply inactive actors, current permission
sets, visible/hidden/restricted records, valid/expired/revoked/inactive-owner OAuth
rows, personal mailboxes on distinct owners and native member/admin-pending
sessions. See `src/test/integrationPlatformFixturesModels.ts`,
`integrationPlatformFixturesNative.ts`, and the qualification record
`crm-fixtures-qualification.md`.

Factory access JTIs are row identities, not signed bearer tokens. For an actual
MCP HTTP case, mint a local test token through the current OAuth path; do not
treat a raw JTI or the fixture's native cookie preimage as an MCP bearer token.
Freeze only Date coherently where deterministic expiry is needed, leaving real
database/network timeouts live. Keep all data synthetic and use the existing
disposable harness/cleanup, under the agreed finite resource window.

Authorization must remain independent of FA/DE/EN language, digit system, Iranian
or Gregorian display and time zone. Keep the existing privacy/error semantics
and single-tenant product boundary. No unrelated provider approval is needed for
these local negative cases.

QA-005 remains open: it requires executed security regression across all six
acceptance dimensions. This source map and backlog do not supply missing grant
scope/app-role enforcement or replace the owning run's exact-head evidence.

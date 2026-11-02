# BASE-007: authorization and account boundary audit

Inspected 2026-10-31 at source head `2f6098b13455fc241389df48b4d4a17f1eed77a7`
on `codex/integration-platform-preview`. This is a source review, not a runtime,
provider or security qualification. Existing tests below were inventoried, not
executed for this audit. No private environment or credential values were read.

## Actor and session paths

| Entry point                                    | Current enforcement                                                                                                                                                                                                                                                                                       | Source evidence                                                                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| App pages and tRPC                             | Cookie credential resolves to an unrevoked, unexpired session for an active user. Non-legacy sessions additionally pass current email/MFA/session policy. Context then hydrates the current actor; protected procedures require actor and session.                                                        | `src/features/auth/session.ts:45-98`; `src/server/trpc/context.ts:22-32`; `src/server/trpc/trpc.ts:9-14`                                             |
| Sensitive authentication/integration workflows | Better Auth workflow session resolution loads hashed session credentials, active user and auth identity, applies current policy, and optionally requires fresh authentication. Slack actions also check CSRF.                                                                                             | `src/features/auth/better/sessionPolicy.ts:14-86`; `src/features/integrations/actions.ts:22-38`                                                      |
| MCP HTTP                                       | Verifies bearer token signature, issuer, fixed MCP audience, database expiry/revocation and subject binding, then hydrates the current active actor. A request-local app context adapts that actor to existing domain/tRPC services.                                                                      | `src/features/oauth/tokens.ts:62-107`; `src/features/mcp/auth.ts:16-40`; `src/features/mcp/http.ts:16-36`; `src/features/mcp/actorContext.ts:25-30`  |
| Realtime                                       | A signed, expiring ticket is atomically consumed once and its session is revalidated at upgrade. Subscription checks bind user channels to the actor, import channels to creator/admin, and deal/pipeline channels to visibility.                                                                         | `src/server/ws/authorize.ts:19-89`; `src/server/ws/authorize.ts:109-147`; `src/server/ws/authorize.ts:161-190`                                       |
| Background work                                | `hydrateActor` has no cookie dependency and is already shared with background imports. Mail delivery resolves credentials by account ID; current token access is not itself an actor/role evaluator. New integration jobs must explicitly rehydrate and authorize immediately before the external effect. | `src/server/hydrateActor.ts:17-28`; `src/features/email/worker.ts:34-44`; `src/features/email/worker.ts:75-90`; `src/features/email/tokens.ts:32-58` |

`hydrateActor` reads the user, a single assigned permission set, visibility
memberships and managed-team members. It returns null for missing/inactive users.
Team membership grants are only hydrated when `team.viewMembers` is present
(`src/server/hydrateActor.ts:20-73`). Admin is a CRM role, not a tenant identity.
There is no new tenancy boundary in these paths.

## Canonical CRM permission and visibility seams

- `can` denies inactive users before its admin bypass, requires a visible record
  for record actions, then resolves own/any/team capabilities and the narrow
  activity-assignee exception (`src/features/permissions/can.ts:15-64`).
- `canSee` denies inactive users before admin bypass. For ordinary users the
  restricted-pipeline gate precedes explicit visibility, ownership, managed-owner
  and group/all visibility (`src/features/permissions/canSee.ts:5-40`).
- SQL list filtering has the same intended contract, including dead-session
  denial, in `dealVisibilityPredicate`
  (`src/features/permissions/sql.ts:36-80`). Preserve its parity with `canSee`.
- Actor adapters used by MCP preserve group IDs, managed-user IDs and permission
  flags; create operations additionally load the primary visibility group
  (`src/features/mcp/actorContext.ts:33-75`). Creation ownership and group defaults
  are centralized in `src/features/permissions/entityCreate.ts:24-60`.
- MCP reads route through existing tRPC/domain reads; writes call domain mutation
  services. Newly created records whose ownership makes them invisible are
  reported without returning the record
  (`src/features/mcp/tools/reads.ts:40-138`;
  `src/features/mcp/tools/writes-deals.ts:33-67`).

These are suitable enforcement primitives for ARCH-004. They do not yet intersect
CRM authority with a separate integration grant, application role or selected
resource policy. An explanatory tool annotation does not add that intersection.

## Personal mailbox ownership and privacy

Gmail is currently one personal mailbox per CRM user. Binding requires verified
Google email, the configured Workspace hosted domain, and the same normalized
email as the signed-in CRM account. Reconnect upserts by `user_id`; another user's
already-bound email address fails without overwriting their account
(`src/features/email/oauth.ts:85-140`). The callback gets identity from its
authenticated context and verifies a single-use state cookie
(`src/app/api/gmail/oauth/callback/route.ts:43-74`). This is distinct from Google
login and must stay distinct.

`assertMailboxOwner` returns the same denial for missing and foreign accounts
before token use (`src/features/email/mailboxOwnership.ts:73-86`). Mailbox status
DTOs omit credential bytes (`src/features/email/mailboxOwnership.ts:36-70`). The
send domain checks mailbox ownership before constructing the actor and resolving
other content (`src/features/email/send.ts:108-149`). MCP draft creation selects
the actor's own mailbox, while updates/deletes delegate ownership to the draft
repository (`src/features/mcp/tools/writes-email.ts:50-85`, `90-140`).

Mail privacy has a stronger rule than ordinary CRM records: private threads have
no admin bypass; a non-owner may read a shared thread only through a visible linked
deal or person. Personal Inbox remains owner-scoped
(`src/features/email/emailVisibility.ts:20-55`;
`src/features/email/emailReads.ts:65-82`, `138-147`). `canSeeEmail` assumes its
caller supplied an authenticated active actor; its owner fast path does not
independently load current account activity. Preserve the request/job caller
boundary when reusing it.

Provider refresh currently loads encrypted credentials by account ID, with no
actor, account-status or active-user predicate of its own
(`src/features/email/tokens.ts:32-58`). Offboarding removes refresh credentials,
but that is distinct from proving safety for an already acquired access token or
an in-flight external send. Execution-time revocation/authorization races need
dedicated negative coverage in CONN/EVT/MAIL.

## OAuth grants and MCP access

The current identities are client plus user plus individual auth-code/access/
refresh records. The tables do not store a separate grant ID, consented capability
set, resource selection or grant version
(`src/db/schema/oauth.ts:3-54`). Authorization input accepts optional `scope`,
but the code binding stores only client, user, redirect URI and PKCE challenge
(`src/features/oauth/authorize.ts:11-19`, `42-73`).

Existing defenses to preserve:

- Public registration validates redirect schemes/loopback exceptions and strips
  misleading control/bidi characters from client display names. These names are
  self-asserted, not verified publisher identity
  (`src/features/oauth/clients.ts:7-10`, `32-55`, `58-111`). Discovery may omit
  registration when disabled (`src/features/oauth/metadata.ts:9-26`).
- Consent issuance requires a fresh workflow session under the MCP grant
  advisory transaction lock (`src/features/oauth/consent.ts:7-18`).
- Authorization codes enforce PKCE, redirect/client binding, expiry and atomic
  single use (`src/features/oauth/authorize.ts:76-110`).
- Exchange/refresh shares the grant lock, checks the active owner, and binds the
  returned token to client and user (`src/features/oauth/exchange.ts:35-82`).
- Access JWTs have a fixed `${BASE_URL}/api/mcp` audience; verification also
  checks the stored grant row on every HTTP authentication
  (`src/features/oauth/tokens.ts:38-107`). Refresh rotation atomically consumes
  the prior hash, checks the expected client and inserts its successor
  (`src/features/oauth/tokens.ts:126-165`).
- The connection list and user-initiated revoke are scoped to `ctx.actor.id`.
  The list retains a connection while a live refresh grant remains
  (`src/features/oauth/router.ts:6-47`;
  `src/features/oauth/revokeAction.ts:13-28`).

Current unsupported restriction: all authenticated MCP requests get
`authInfo.scopes: []`, and both read and write tool groups are registered
(`src/features/mcp/auth.ts:34-40`; `src/features/mcp/server.ts:9-12`). Domain
permissions limit the actor, but there is no grant-level read-only boundary.
`readOnlyHint` and other annotations describe tools only
(`src/features/mcp/tools/types.ts:76-91`). An actor who can write through the app
may currently write through an authorized MCP client. Do not label an existing
grant read-only or minimal-scoped until AISEC implements server enforcement.

The HTTP handler authenticates and hydrates once before creating its request-local
tool handler. Tool callbacks reuse that actor snapshot
(`src/features/mcp/http.ts:16-36`;
`src/features/mcp/tools/types.ts:50-53`). Subsequent requests rehydrate, but
revocation/role change during one in-flight request is not independently checked
by this adapter at every tool-side effect. ARCH/AISEC must define and test the
required decision time and delayed-action behavior.

## Slack workspace ownership

Slack is currently an administrator-managed shared connection. Its table has one
globally unique `(provider, account_id)` row, an `owner_id`, encrypted credential,
upstream scopes and channel settings, but no personal/shared discriminator,
delegated-use policy, installation identity or separate grant/credential records
(`src/db/schema/integrations.ts:15-38`). The owner is the authorizing administrator,
not the only administrator allowed to manage it.

- Begin/callback/credential use require an active administrator. Actions and
  callback require fresh authentication. The callback binds state to user and
  exact session, consumes it once, then rechecks admin after the provider round
  trip inside the save transaction
  (`src/features/integrations/service.ts:19-25`, `28-77`, `87-123`;
  `src/features/integrations/actions.ts:22-35`;
  `src/app/api/integrations/slack/callback/route.ts:14-34`).
- Reconnect of the same Slack workspace upserts that shared row and overwrites
  `owner_id` with the current administrator. There is no explicit owner transfer
  approval or personal-account duplicate policy
  (`src/features/integrations/service.ts:96-117`).
- `withSlackConnection` checks the current caller is admin, provider matches and
  status is connected, then decrypts. It does not require `owner_id == caller`
  (`src/features/integrations/service.ts:146-175`). Any active administrator can
  operate the shared Slack connection under the current policy.
- Disconnect blocks ordinary credential consumers by setting
  `revocation-pending` before contacting Slack. It retains encrypted credentials
  on failure for explicit retry, and clears them on success
  (`src/features/integrations/service.ts:178-207`). No background retry or
  notification-rule grant is established by this path.
- All authenticated users of Connections currently receive service metadata,
  including account name, channel settings, owner name and upstream scopes.
  Credentials are excluded, but this is workspace-wide metadata disclosure,
  rather than owner-specific listing
  (`src/features/integrations/service.ts:128-143`;
  `src/app/(app)/settings/connections/page.tsx:31-38`, `65-69`).

The existing service uses AES-256-GCM credential storage from the email crypto
module (`src/features/email/crypto.ts:12-46`). It has one environment encryption
key and no credential key ID/version column in the connection schema. Key
rotation remains separate work.

Offboarding revokes sessions, MCP codes/tokens, invitations and auth mail, queues
Google token revocation and disconnects the user's Gmail accounts. It does not
update Slack `integration_connections`
(`src/features/auth/management/offboarding.ts:11-48`). An inactive administrator
cannot call `withSlackConnection`, but another active administrator can use that
shared workspace even when its recorded owner was offboarded. ARCH-002 must
choose explicit retention/transfer rules for shared connections before automated
jobs make owner status meaningful.

## Existing negative-test map

These files are acceptance inputs for a fresh baseline run, not new pass claims.

| Boundary               | Existing cases and locations                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actor/CRM visibility   | Inactive admin denial, missing record denial, own/any/team scope and restricted pipeline precedence: `src/features/permissions/can.test.ts:51-109`, `canSee.test.ts:25-182`; SQL/pure parity and dead session: `src/features/permissions/sql.test.ts:181-230`; missing team view grant: `src/server/hydrateActor.integration.test.ts:43-58`.                                                                                                                                 |
| Mail privacy/ownership | Foreign and nonexistent mailbox return the same error: `src/features/email/mailboxOwnership.test.ts:23-55`; private thread hidden even from non-owner admin, shared unlinked thread hidden: `src/features/email/emailReadsVisibility.test.ts:29-100`; wrong identity/domain/unverified identity and duplicate bound email: `src/features/email/oauth.test.ts:69-160`.                                                                                                        |
| OAuth/MCP              | PKCE/binding/expiry/single use: `src/features/oauth/authorize.test.ts:13`; revoked token and unusable identity: `src/features/oauth/tokens.test.ts:15`, `src/features/mcp/auth.test.ts:9`; wrong audience and refresh-only connection visibility: `src/features/oauth/resource.integration.test.ts:12-40`; stale consent/policy race: `src/features/oauth/consent.integration.test.ts:48-59`; suspended refresh owner: `src/features/oauth/exchange.integration.test.ts:92`. |
| Domain tools           | Regular actor create denied and hidden lead not found: `src/features/mcp/tools/writes.test.ts:34-87`; ownership transfer does not echo newly hidden records: `src/features/mcp/tools/writes-ownerOverride.test.ts:35-82`; foreign draft update/delete denied: `src/features/mcp/tools/writes-email.test.ts:244-284`.                                                                                                                                                         |
| Offboarding/policy     | Permanent local grant revocation with no resurrection: `src/features/auth/management/offboarding.integration.test.ts:67`; MFA-policy tightening revokes codes and grants atomically, admin promotion invalidates prior grants: `src/features/auth/management/mcpPolicy.integration.test.ts:73-93`.                                                                                                                                                                           |
| Slack                  | Regular-user denial, session-swapping denial before provider I/O, callback concurrency/single use, deactivated-admin credential denial, local block during failed remote revocation, metadata excludes credentials: `src/features/integrations/service.integration.test.ts:65-154`.                                                                                                                                                                                          |
| Realtime               | Ticket replay/dead session and unauthorized user/deal/import channels: `src/server/ws/authorize.test.ts`, `src/server/ws/authorizeDeal.test.ts`, `src/server/ws/authorize.import.test.ts`.                                                                                                                                                                                                                                                                                   |

New matrices are needed for grant read-only/direct-call bypass, capability removal
between enqueue and delivery, shared-connection offboarding/transfer, stale
credential versions during reconnect/refresh, destination audience changes, and
the intersection of app roles with CRM visibility. Existing tests must not be
treated as coverage for those future contracts.

## ARCH and CONN implementation seams

1. Keep `hydrateActor`, `can`, `canSee`, SQL visibility and stronger email privacy
   authoritative for CRM access. Add a shared server evaluator that intersects
   current actor authority with grant capabilities, selected resources, installation
   state and application role; do not replace the domain evaluators with UI hints.
2. Model installation, upstream account, owner/personal-or-shared policy, grant,
   and credential version separately. Migrate existing Slack rows as shared admin
   connections and existing Gmail rows as personal accounts without widening
   their privacy or silently enabling multi-account mail.
3. Carry immutable actor/grant/connection references into jobs, then reload current
   state immediately before data disclosure or provider effects. Explicitly define
   revocation races and ambiguous outcomes rather than implying instantaneous
   cancellation of completed external requests.
4. Generalize the existing Slack callback's session-bound one-use attempt and
   post-provider permission recheck. Preserve encrypted secret-free DTOs; add
   reviewed ownership/transfer and duplicate-account rules before provider reuse.
5. Preserve the MCP issuance/offboarding transaction lock. Add persisted
   capabilities and grant/version IDs to auth codes, refresh/access tokens and
   the request/job context; enforce them both in tool discovery and invocation.
   Give direct endpoint and embedded-action calls the same evaluator.
6. Use local simulators and real PostgreSQL for these contracts. Real Slack,
   Gmail and AI-host validation remain distinct live-provider tasks.

BASE-007's requested source map is supplied here. This document does not close
ARCH, CONN or AISEC implementation tasks and does not modify their status.

# ARCH-001 to ARCH-005: identities, authority and lifecycle contract

Decision record, 31 October 2026. Source reviewed at
`3d653a70884fdc384ec38aefef0d2636a5431c30` on
`codex/integration-platform-preview`. Owner: integration programme execution.
This file supplies design decisions and review scenarios for ARCH-001 through
ARCH-005. It does not add runtime enforcement or qualify a provider. Task status
and acceptance evidence remain in `tasks.csv`; this document does not edit them.

The existing enforcement baseline is recorded in
[the BASE authorization audit](authorization-account-audit.md). Rechecked source
references below distinguish that baseline from the contracts to implement in
CONN, AISEC, MCP, MAIL and SDK. Independent mail/connection work must adopt or
reconcile these contracts through an immutable handoff, not a competing schema.

## 1. Product boundary and decision summary

The deployment remains one self-hosted company CRM. A connection's personal or
shared owner scope describes who may use it within that company; it is not a
tenant boundary. CRM administrators do not acquire private mailbox content merely
because they administer connections. An app installation, OAuth client or workflow
cannot create a new CRM administrator or bypass current record visibility.

| Decision | Selected local contract                                                                                                                   | Existing enforcement versus implementation work                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A1       | Separate installation, upstream account, connection, grant and credential identities.                                                     | Current Slack rows combine several of these; new model/migration belongs to CONN.                            |
| A2       | Personal accounts stay owner-only. Shared connections have an administrator custodian and explicit delegated-use grants.                  | Gmail is owner-bound; Slack currently permits any active admin. Delegation/transfer is future CONN behavior. |
| A3       | Use one versioned capability vocabulary, with separate reads, mutations, outbound effects, selected resources and administration.         | Current OAuth grants do not persist capability scopes. AISEC/API/SDK must add them.                          |
| A4       | Evaluate current actor authority intersected with grant, app role, selected resources and lifecycle at every disclosure/effect boundary.  | Current domain evaluators remain authoritative; the shared intersection evaluator is future implementation.  |
| A5       | Persist explicit lifecycle reasons and revisions; reconcile provider health separately from local permission and credential availability. | Current connection status and UI presentation are coarser. CONN must migrate them with evidence.             |

Language, numbering system, calendar and time zone are independent user preferences.
None participates in an identity key, capability name or authorization decision.
Stable IDs, instants and civil-date wire values are language-neutral; FA/DE/EN copy
renders the same authoritative state. Persian display does not imply Persian
digits or an Iranian time zone, and German display does not force Gregorian
calendar semantics. Natural Farsi copy is reviewed first, with German and English
in the same implementation acceptance gate.

## 2. Identity model and invariants, ARCH-001

| Entity                | Stable identity and purpose                                                                                                                                                                                                                       | Required distinctions                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installed application | Internal `installationId`, package/publisher identity, pinned version, install mode, status and granted app-role policy. Core trusted adapters use an explicit native installation identity; SDK apps later use an isolated package installation. | A package listed in a catalog is not installed. Installing an app neither connects an upstream account nor grants all CRM access. Upgrading a package retains installation identity and changes version.                            |
| Upstream account      | Internal `upstreamAccountId` plus provider-defined stable subject under provider ID, issuer/environment and account kind. Examples are an upstream workspace or personal mailbox identity.                                                        | Display name/email is mutable metadata, not a general identity key. Provider-side app installation IDs, where relevant, are recorded separately from CRM installation IDs. Test and production provider environments never collide. |
| Connection            | Internal `connectionId` links connector installation, upstream account, owner scope, personal owner or shared custodian, selected resources and lifecycle revision.                                                                               | A connection is a local usable relationship. Two grants may authorize distinct uses of one connection; neither duplicates the upstream account.                                                                                     |
| Authorization grant   | Internal `grantId`, subject actor, client/installation binding, audience, capability vocabulary version, explicit capability set, selected-resource constraints, expiry/revocation and monotonic policy revision.                                 | Upstream OAuth scopes and downstream CRM capabilities are separate fields. A provider token having `chat:write` does not grant an MCP client CRM writes or permission to disclose records into a channel.                           |
| Credential            | Internal `credentialId`, grant/connection binding, encrypted material, key ID, generation, issued/expiry/revocation metadata and non-secret provider fingerprint if available.                                                                    | Rotation replaces secret material without changing connection identity. Credential possession is not authorization. Tokens and encryption keys never enter DTOs, jobs, audit payloads, bundles or UI state.                         |
| Authorization attempt | Random one-use state digest, actor, exact fresh session, intended installation/connection, requested capabilities, expected account if reconnecting, expiry and consumed outcome.                                                                 | A pending attempt cannot overwrite a usable credential or silently switch ownership. A failed attempt is retained only under the retention policy.                                                                                  |

References between these entities are immutable or change through explicit,
audited compare-and-swap transitions. The database enforces applicable uniqueness
and foreign keys. Updates carry expected connection/grant revision and credential
generation; a losing concurrent callback/refresh cannot replace newer authority.
Revoked grant IDs and removed connection IDs are never recycled.

Provider-specific uniqueness must be declared before enabling an adapter. The
migration preserves the current no-duplicate usable relationship policy, while
separating stable upstream identity from retained connection tombstones:

- Slack has at most one nonremoved shared connection per upstream workspace in
  this CRM. Reconnect targets that row. The stable upstream-account identity
  remains unique across its provider/environment; removed connection instances
  retain their UUID and lineage. CONN migration must replace the current global
  connection `(provider, account_id)` unique index with the equivalent nonremoved
  relationship constraint, preserving existing rows and refusing conflicting live
  rows. A new connection after removal gets a new UUID referencing that same
  upstream account. Until that migration is qualified, the legacy reconnect path
  remains unchanged and must not claim the tombstone/new-instance lifecycle.
- Gmail remains one personal mailbox per CRM owner and one binding for a mailbox
  address under its current verified identity policy. Multi-account or independent
  mail support needs its own accepted MAIL contract and migration; this decision
  does not silently enable it.
- A new provider with no reviewed duplicate-account policy fails closed. A
  capability to manage connections is not permission to merge account identities.

| Identity scenario                                               | Required result                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I1: Reconnect same account, same owner and compatible grant     | Retain connection/account IDs and selected resource IDs, stage a new credential generation, validate required upstream scopes, then atomically activate it. Reset successful-health metadata. Missing resources require configuration; added scopes remain inactive until consented. |
| I2: Reconnect returns a different upstream account              | Reject the replacement with a localized account-mismatch result and leave the prior connection unchanged. Offer an explicit new-connection path subject to uniqueness. Do not silently transfer or merge historical data.                                                            |
| I3: Two callbacks authorize the same account concurrently       | Consume each attempt at most once. Uniqueness plus expected revision yields one winning transition; the losing attempt reports conflict/review. No credential or owner from the loser overwrites the winner.                                                                         |
| I4: An existing shared workspace is connected by a second admin | Resolve its existing connection without exposing its credential. Require explicit takeover/transfer and reauthorization policy below; a successful callback alone does not overwrite custodian.                                                                                      |
| I5: A second CRM user tries another person's personal mailbox   | Deny without revealing whether a foreign connection exists. No token is stored or transferred. Current Gmail identity matching remains enforced.                                                                                                                                     |
| I6: Display name, email alias or localized label changes        | Update validated metadata under the same stable upstream ID; never create another account solely because the display changed. A legacy email-keyed binding needs a reviewed migration, not automatic inference.                                                                      |
| I7: Credential refresh races with disconnect or reconnect       | The generation/revocation check rejects a stale credential write. Disconnect wins local usability; a late refresh cannot revive it. New reconnect consent creates fresh authority.                                                                                                   |
| I8: Removed account is connected again                          | Create a new connection/grant identity, retain the old tombstone/audit link, and require explicit resource selection. Removed grants and queued jobs stay revoked.                                                                                                                   |

Current Slack behavior to migrate deliberately: the callback already binds its
one-use attempt to user and session and rechecks admin after provider I/O, but its
upsert overwrites `ownerId` on duplicate workspace
(`src/features/integrations/service.ts:55-123`). Current OAuth grant tables have
client/user/token identities without per-grant capabilities
(`src/db/schema/oauth.ts:3-54`). Neither future identity separation nor migration
is delivered by writing this contract.

## 3. Personal and shared ownership, ARCH-002

All actors must be active, authenticated under current policy, and allowed the
requested operation. Connect, reconnect, permission expansion, ownership transfer
and removal require fresh verification and CSRF protection on browser mutations.
An API/MCP credential cannot stand in for fresh human consent to expand itself.
Operators provision server credentials; provisioning grants no CRM data access.

| Operation                 | Personal connection                                                                                                                                                                                                    | Shared connection                                                                                                                                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connect                   | The future owner connects their own verified upstream account under that provider's identity policy. An admin cannot connect a user's private mailbox as that user.                                                    | An active admin with `admin.connections.manage` establishes a shared connection and names an active admin custodian. Installation/provider policy and fresh consent still apply.                                                                                    |
| View metadata             | Owner sees account identity, selected resources, health and grants. Admin security inspection gets only bounded operational metadata, with an audit trail and no private content. Other users get no existence oracle. | Admins see operational metadata. Delegated users see only the identity/resource/status needed for their approved use; broad company directory exposure is not the default.                                                                                          |
| Use                       | Owner, or a client/app explicitly acting for that owner, needs the relevant grant, resource selection and CRM authority. No implicit colleague delegation for private mail.                                            | A named active actor or controlled group may use only explicitly granted capabilities and resources. Admin status alone does not bypass grant/application policy for automated execution.                                                                           |
| Configure resources/rules | Owner may change their selection within upstream entitlement; widened capability/resource disclosure needs consent.                                                                                                    | Custodian or another active admin with management authority may configure. Widening destinations or field disclosure needs a new reviewed policy revision and invalidates stale job authorization.                                                                  |
| Pause/resume              | Owner may pause. An admin may impose a security pause. Owner cannot remove an administrative hold; release requires the administrator's audited decision.                                                              | Custodian/authorized admin may pause; resume requires valid grants, active custodian and current selected-resource checks. Delegated users cannot resume or remove a hold.                                                                                          |
| Transfer                  | No personal credential or private mailbox transfer. Reconnect as the new owner through a new personal connection; existing data follows explicit retention/privacy policy.                                             | Explicit admin initiation plus target active admin acceptance and fresh upstream reauthorization for the same account. Atomically change custodian and policy revision, revoke old delegated grants and review replacement grants. Never copy personal credentials. |
| Disconnect/remove         | Owner revokes all local use immediately. An admin may security-disable/remove under a bounded audited operation without reading private content. Remote revocation may finish later.                                   | Custodian or authorized admin immediately blocks ordinary use, revokes delegated grants and requests remote revocation. Selected-resource users cannot remove the shared connection.                                                                                |

No operation grants unbounded cross-domain administration through a provider
credential. A personal owner cannot convert their connection to shared, or the
reverse, by editing an owner field. Such a product feature would require a
separate data-disclosure review, new consent and new grants; it is not selected
here.

Shared custodian offboarding pauses connection-backed automation and invalidates
its outstanding delegation revisions. An authorized remaining admin may recover
it only through the transfer/reauthorization flow above. A personal owner's
offboarding blocks access and queues remote revocation; reactivation does not
revive old grants. Workflow/rule execution actors are explicit active users.
An event initiator is attribution, never an implicit substitute for a rule's
authorizing actor. No worker defaults to admin when its actor is absent.

| Authorization review scenario                                                | Decision and reason                                                                                                                                                                          |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1: Regular user connects own verified personal account                      | Allow under its provider policy; another user's identity, missing verification or foreign account ID denies before credential persistence.                                                   |
| O2: Admin reads another person's private mail                                | Deny, even with connection-management capability. Private mail has no admin content bypass.                                                                                                  |
| O3: Member has shared Slack post delegation to channel A                     | May post only through an approved rule/action into A, with current CRM visibility and destination disclosure policy. Cannot configure B, transfer, reconnect or decrypt secrets.             |
| O4: Admin manages shared connection but lacks an app's approved write grant  | May use first-party administrative management where allowed; the app's attempted CRM mutation denies. The app never inherits its installing admin's full role.                               |
| O5: Custodian changes company role or is offboarded                          | Pause ordinary automation, invalidate old authorization revision, preserve historical attribution, require explicit recovery. Jobs do not pick another admin automatically.                  |
| O6: Target custodian is inactive or callback returns another workspace       | Transfer denies atomically; no owner, grant or credential is replaced.                                                                                                                       |
| O7: Personal owner removes account during a queued send                      | Stop unstarted send effects, mark affected jobs cancelled/blocked, and retain safe diagnostics. An already accepted remote send is recorded as completed or ambiguous, not claimed recalled. |
| O8: Member loses delegation/group membership after preview                   | Delivery rechecks current membership/resources and denies. A successful preview is not reusable authority.                                                                                   |
| O9: Admin security-disables a personal account                               | Block future effects and revoke its delegated tokens; expose only operational confirmation, never mailbox content. Owner cannot clear the admin hold.                                        |
| O10: Admin A initiates transfer to admin B, then A loses admin before commit | Recheck both actors and current revisions at commit; reject. B must not accept a stale transfer on A's former authority.                                                                     |

Current source has narrower mechanisms: Slack management requires any active admin
(`src/features/integrations/service.ts:19-25`, `146-175`); Gmail access checks
owner (`src/features/email/mailboxOwnership.ts:73-86`); offboarding sweeps
sessions/MCP/Gmail but not shared Slack rows
(`src/features/auth/management/offboarding.ts:11-48`). The selected shared
offboarding/transfer policy is additional CONN work, not a description of that
current behavior.

## 4. Shared capability vocabulary, ARCH-003

Vocabulary version 1 uses exact, case-sensitive ASCII identifiers below. There
are no wildcard, prefix, unknown or implicit capabilities. Unknown vocabulary
versions/names deny. Provider scopes are mapped into available operations by an
adapter and intersected with local grants; they are not accepted as CRM scopes.
The persisted canonical vocabulary is reused by API clients, MCP grants and SDK
apps. Host-specific OAuth wire encoding is a versioned adapter concern.

| Family                  | Exact vocabulary/allowed domain expansion                                                                                     | Semantics                                                                                                                                                                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CRM reads               | `crm.<domain>.read`, with domain in `deals`, `leads`, `persons`, `organizations`, `activities`, `pipelines`, `stats`          | Read only fields/rows permitted by the domain evaluator and any approved projection. Stats must not aggregate hidden records. A domain name outside this registry needs a versioned addition.                                                                                          |
| CRM ordinary writes     | `crm.<domain>.write`, with domain in `deals`, `leads`, `persons`, `organizations`, `activities`                               | Create/update and documented non-destructive domain transitions, still checked against exact existing CRM actions. Deals include stage/status changes; activities include completion. This is not permission to delete, archive, transfer ownership or trigger external communication. |
| CRM distinct mutations  | `crm.<domain>.delete`, `crm.<domain>.archive`, `crm.<domain>.transfer`, only where the underlying domain supports that action | Separately consented destructive, archival or ownership-changing action. Unsupported combinations deny; a grant does not invent a domain operation. Lead conversion needs `crm.leads.write` plus `crm.deals.write` and all domain conversion/reference checks.                         |
| Mail                    | `mail.messages.read`, `mail.drafts.read`, `mail.drafts.write`                                                                 | Personal/shared-message visibility and draft ownership still apply. A draft write grants no send authority.                                                                                                                                                                            |
| Calendar                | `calendar.events.read`, `calendar.events.write`                                                                               | Read/write selected calendar resources under the calendar contract, including its ownership, conflict and recurrence limits. Guest notifications/invitations additionally need outbound authority.                                                                                     |
| Outbound effects        | `outbound.slack.post`, `outbound.mail.send`, `outbound.calendar.invite`, `outbound.conference.create`                         | Explicit permission for the named external effect, in addition to the matching connection/resource and source-record permissions. No outbound permission implies CRM read or write. Conference creation needs the reviewed provider/entitlement contract.                              |
| Resource administration | `connection.resources.select`                                                                                                 | Change selected upstream resources within an owned/administered connection. It does not grant use of those resources or consent to new disclosure. Resources are also bound constraints on every use grant.                                                                            |
| Workflows               | `workflow.view`, `workflow.create`, `workflow.edit`, `workflow.publish`, `workflow.run`, `workflow.cancel`                    | Map to current `canWorkflow` ownership and permission flags. A run also requires every node's domain, connection and outbound capabilities at execution. Publishing never delegates extra authority.                                                                                   |
| Administration          | `admin.connections.manage`, `admin.grants.manage`, `admin.apps.manage`                                                        | Require current CRM admin plus the explicit operation grant for API/client/app execution. They never imply private content read. SDK apps cannot request administration in the first private reference profile; first-party admin workflows use a distinct trusted principal path.     |

The `<domain>` notation is documentation of finite registered names, not a runtime
wildcard scope. Implementation must enumerate supported combinations and each
operation-to-capability mapping. UI groups such as read-only or read/write expand
into an explicit reviewed set; a later registry addition is never silently added
to an existing grant. Writes do not imply reads. A write-only actor can receive a
minimal operation receipt, but returning record fields additionally requires read
capability and current visibility. Permission to create a record does not ensure
that the creator may see it after ownership defaults/transfer.

Resources are immutable-ID constraints attached to the grant: connection IDs,
upstream account IDs, selected calendar/channel IDs, CRM domain or pipeline
restrictions and a permitted field projection where applicable. Names are display
only. An empty resource set means none, not all. Whole-company access, where
appropriate, is an explicit consented selector with a documented domain policy.
Adding a selected channel/calendar cannot widen an existing grant automatically.

| Policy example                                             | Required capability intersection                                                                                                                                                                                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1: Read-only MCP client asks to move a deal               | Deny despite the actor having CRM edit permission, because `crm.deals.write` is absent. Tool discovery also omits the write, but invocation enforces independently.                                                                                      |
| C2: App updates a visible deal then posts its summary      | Require `crm.deals.write`, permitted exact CRM action, `crm.deals.read` for disclosed fields, `outbound.slack.post`, matching channel selection and destination field allowlist. Default link-only policy remains the selected safe disclosure contract. |
| C3: Client drafts an email                                 | Require `mail.drafts.write`, owner mailbox and referenced-record checks. Sending later requires new `outbound.mail.send` authority and execution checks.                                                                                                 |
| C4: Calendar edit adds guests                              | Require `calendar.events.write` plus `outbound.calendar.invite` and selected-calendar ownership. No invitation is sent when only ordinary event-write authority exists.                                                                                  |
| C5: Workflow publisher configures a future external action | Publication validates referenced contracts but does not grant send rights. The execution actor and run grant must hold the node's required capabilities when it executes.                                                                                |

Pending channel extensions do not borrow another channel's authority. The unimported
SMS amendment would require separate `outbound.sms.send`, `sms.receipts.read` and
`sms.inbound.read` names, with sender/account, approved recipient/consent policy,
message/effect identity and callback-resource constraints. Sending grants neither
inbound content nor receipt access; receipt access does not grant sending. Those
names are a proposed explicit vocabulary extension, not members of current v1
grants, implemented SMS support, or adoption of the 586-row scope. Reconcile the
amendment and publish a reviewed vocabulary revision before enabling such actions.
The same rule applies to later provider-specific outbound actions: no wildcard,
mail/Slack alias or implicit expansion of existing grants.

Current CRM `can` and `canSee` remain the domain layer
(`src/features/permissions/can.ts:35-64`, `canSee.ts:5-40`), while workflow access
is `src/features/workflows/access.ts:5-12`. MCP currently sets empty `scopes` and
registers both tool groups (`src/features/mcp/auth.ts:34-40`, `server.ts:9-12`).
No read-only claim is supported by this design record alone.

## 5. Authoritative evaluator, ARCH-004

Implement one shared server entry point owned by `src/features/permissions/`,
provisionally `evaluateIntegrationAuthority(db, request, signal)`, with
feature-owned adapter policies. The name is an architectural seam, not an
existing export. It returns a Result containing an allow decision with bounded
projection/revision metadata, or a stable non-secret denial. It never returns a
credential. Existing `can`, `canSee`, SQL visibility, email privacy and workflow
evaluators remain the authority on their respective domain checks.

Trusted input references identify principal actor, initiating actor for audit,
transport/client/installation, grant, connection, intended exact operation,
resource IDs, target record/reference IDs and expected revisions. Client-supplied
role flags, arbitrary owner IDs, scopes or precomputed allow booleans are ignored.
The evaluator loads current persisted facts and validates these bindings.

An allow decision requires all applicable terms:

```text
live authenticated principal or valid bounded background delegation
AND active CRM actor under current policy
AND enabled installation and compatible app role
AND unexpired, unrevoked grant bound to this client/installation/actor/audience
AND exact requested capabilities in the grant AND app-role ceiling
AND authorized personal ownership or shared delegation
AND selected resources and approved disclosure projection
AND connection/grant/credential lifecycle permits this operation
AND current domain visibility/action/reference checks
AND provider scopes/entitlement support the exact external operation
```

For trusted first-party interactive workflows there may be no delegated client
grant. That is a separately authenticated principal kind with normal CSRF/fresh
verification/domain checks, never a fallback when a supplied grant fails. An app
role can narrow the maximum capability set; it cannot add capabilities absent
from consent or make a regular user an admin. Read-only grants remain read-only
for an admin. Private-mail privacy is retained even when CRM `canSee` would allow
admin access to the linked record.

Enforcement boundaries:

1. HTTP/server-action/tRPC/MCP entry authenticates and checks the operation before
   data exposure. Direct tool invocations and embedded UI actions use the same
   evaluator; hiding UI or annotating a tool is insufficient.
2. SQL lists include domain visibility and approved resource filtering before
   pagination/counting. Unauthorized records/fields never become an in-memory
   result that is filtered after counts or snapshots leak them.
3. Enqueue stores references/revisions, not serialized actor flags or token bytes.
   A preview decision is diagnostic only. A durable background grant is explicit,
   bounded to rule/action/resources and attributable to an active execution actor.
4. A worker rehydrates actor, grant, owner/delegation, selected resources and
   lifecycle immediately before each outbound attempt. Revocation, role change
   and provider-account replacement invalidate pending decisions.
5. Database effects and authorization-sensitive revisions are checked in the
   mutation transaction. Grant issuance/revocation retains the current shared MCP
   transaction lock (`src/features/auth/management/mcpGrants.ts:5-21`). Secrets
   are released only through the credential broker after the fresh decision.
6. Select one deployment-wide PostgreSQL transaction advisory read/write gate
   (`integration-authority-v1`) as the initial serialization point. An integration
   database-effect transaction takes the shared gate before actor/grant/domain
   hydration and retains it through effect/step/cursor commit. Every writer that
   can change relevant authority takes the exclusive gate before its first write:
   actor activation/roles/permission sets, visibility membership or record/pipeline
   ACL/ownership, installation/app role, connection custodian/resources/holds,
   delegation, grant/revocation and credential-generation usability. It changes
   the relevant revisions in that same transaction. A transfer or other effect
   that changes authority takes the exclusive gate from the start; never upgrade
   a held shared gate. Gate order is global authority gate, existing MCP user-grant
   lock, then domain rows in deterministic ID order, with bounded lock/statement
   deadlines and cancellation. If revocation commits first, the effect sees its
   denial; if an effect acquired the shared gate first, revocation waits for that
   authorized effect to commit. This is an explicit ordering guarantee, not a
   promise that revocation cancels an already committed effect. Ordinary effect
   transactions can share the read gate; authority changes are serialized. A later
   narrower gate needs measured equivalence/concurrency evidence before replacing
   this deliberately coarse single-tenant contract. Existing writers do not yet
   implement the gate, so transport/job race claims remain open until all relevant
   writers and real-PostgreSQL negative cases adopt it.
7. External I/O cannot be made atomic with local revocation. Record an attempt's
   authorization revision and start time; block retries after revocation and
   classify an in-flight unknown result as ambiguous. Never promise cancellation
   of an external effect that the provider already accepted.

| Negative-case review                                                         | Required denial/outcome                                                                                                      |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| N1: Expired/revoked token, inactive actor or wrong audience                  | Deny before domain reads and credential access; no transport fallback to trusted first-party authority.                      |
| N2: Read-only grant calls hidden write endpoint/tool directly                | Deny at evaluator; zero mutation/outbound effect even when the actor is admin.                                               |
| N3: Actor loses edit flag or pipeline visibility after enqueue               | Deny at execution using fresh actor/domain state; mark authorization failure without exposing record data.                   |
| N4: App role denies mail but grant/actor allow it                            | Deny. Installation/app role is a ceiling, not informational metadata.                                                        |
| N5: Grant subject/client/installation/connection references are swapped      | Deny binding mismatch; foreign/nonexistent references have the same public shape.                                            |
| N6: Channel/calendar removed, renamed or replaced                            | Stable selected ID controls. A rename updates display only; missing/replaced ID blocks until explicit reselection.           |
| N7: Shared user posts CRM fields not in destination allowlist                | Deny/discard forbidden fields before composing; a generic link must still originate from an authorized source-record action. |
| N8: Admin app reads private foreign thread                                   | Deny under email privacy despite admin and app/grant read flags.                                                             |
| N9: Scope/resource expansion during reconnect without new consent            | Keep old grant ceiling; new capability remains unavailable until a new consented policy revision.                            |
| N10: Missing execution actor, disabled install or unknown capability/version | Fail closed. No ambient worker admin, wildcard or latest-version inference.                                                  |
| N11: Cached allow result reused after pause/transfer/revoke                  | Deny revision mismatch and re-evaluate. Job idempotency key never substitutes for authority.                                 |
| N12: User can write but cannot read the created/transferred record           | Commit only if exact mutation is allowed; return a minimal receipt without unauthorized row fields.                          |
| N13: Hidden records affect counts, search, stats or rich-view payload        | Filter at data source and preserve domain privacy; text and rich-view variants use the same projection.                      |
| N14: Provider supports fewer scopes than local grant requests                | Deny unsupported effect with reauthorization/configuration guidance; no silent downgrade that reports success.               |

Review verification must execute the same cases across direct service calls,
API/MCP transport, embedded actions and delayed jobs, using real PostgreSQL for
ownership/revision/concurrency. Source inspection of this matrix is ARCH review;
passing runtime matrices belong to QA/AISEC/CONN acceptance.

## 6. Lifecycle and reconciliation, ARCH-005

Lifecycle belongs to a connection; installation enablement and individual grant/
credential status remain separate intersected controls. Store state, stable reason,
state revision, transition actor/correlation, changed-at instant and bounded next
retry/review metadata. Store user pause and administrative security hold distinctly
from observed provider health. A provider error must not clear a hold.

Canonical states are `unconfigured`, `authorizing`, `configuring`, `active`,
`degraded`, `reauthorization-required`, `paused`, `revocation-pending`, `removed`.
The reauthorization label is localized; its wire identifier is stable. Health
claims include the time/profile of the actual check, not just successful OAuth.

| State                      | Meaning and ordinary effects                                                                                                                                                      | Allowed transitions and guards                                                                                                                                                                                                                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unconfigured`             | Required operator/provider setup or initial authorization is absent. No ordinary provider effect. Catalog-only entries stay a separate planned UI state.                          | To `authorizing` only after server prerequisite validation plus authorized fresh connect. To `removed` when an existing local draft is discarded. Operator setup alone grants no account access.                                                                                                                                          |
| `authorizing`              | Initial one-use consent attempt is outstanding. No ordinary effects; callback is bound to actor/session/expected account.                                                         | Valid callback to `configuring`, or to `active` only if all mandatory configuration is independently valid. Cancel/expiry/failure returns to `unconfigured`. Admin hold to `paused`; disconnect to `revocation-pending` if credentials exist, otherwise `removed`.                                                                        |
| `configuring`              | Credentials exist but mandatory resource/disclosure selection or capability review is incomplete. Only bounded authorized setup/discovery/checks run.                             | Explicit validated selection to `active`; transient setup failure to `degraded` with setup reason; expired/revoked grant to `reauthorization-required`; hold to `paused`; disconnect to `revocation-pending`.                                                                                                                             |
| `active`                   | Current grant/resources/configuration permit supported operations. Each use still passes authority evaluation.                                                                    | Transient provider/service fault to `degraded`; missing required authorization to `reauthorization-required`; invalid/missing selected resource to `configuring`; explicit/security/custodian hold to `paused`; disconnect to `revocation-pending`.                                                                                       |
| `degraded`                 | A classified recoverable health failure is observed. Bounded retries may run only for still-authorized operations; an unavailable key/storage dependency blocks effect execution. | Verified recovery to prior usable `active` or `configuring`; confirmed grant revocation/required scope loss to `reauthorization-required`; explicit hold to `paused`; disconnect to `revocation-pending`. Retry exhaustion stays degraded with actionable repair, never false success.                                                    |
| `reauthorization-required` | Grant is revoked/expired beyond refresh, required permission is missing, or upstream identity needs renewed consent. No ordinary external effects.                                | An authorized fresh reconnect attempt is an overlay. Successful same-account consent goes to `configuring`/`active` after current checks; failed/cancelled attempt stays here. Hold to `paused`; disconnect to `revocation-pending`.                                                                                                      |
| `paused`                   | User/security/custodian hold blocks ordinary effects even with healthy credentials. Revocation/security maintenance may still run.                                                | Explicit authorized resume only after all holds clear, rehydrating current facts to `active`, `configuring`, `degraded` or `reauthorization-required`. Disconnect to `revocation-pending`. Health recovery alone cannot resume.                                                                                                           |
| `revocation-pending`       | Local grant/credential use is already blocked; only bounded remote revoke/repair may access retained encrypted material. No resume or ordinary send.                              | Remote revoke confirmed or provider reports credential already invalid to `removed`. Network/transient failure stays pending with bounded retry and visible reason. Authorized local-finalize may destroy retained secrets and mark removed while retaining a separate unresolved remote-revocation incident, never claim remote success. |
| `removed`                  | Tombstone retained under audit/retention policy; grants revoked, local credential material destroyed, jobs blocked. Imported data follows its separate visible retention policy.  | Terminal for this connection identity. A new connect creates new connection/grant/credential IDs and fresh selection.                                                                                                                                                                                                                     |

A reconnect of an existing healthy connection uses an `authorizationAttempt`
overlay rather than setting its canonical state to `authorizing`. Its prior grant
continues only while independently valid and not paused/revoked; candidate
credentials are unusable until committed. Reconnect never clears a security hold
or changes owner. A callback started before disconnect/removal cannot win a later
revision check. For a reauthorization-required connection, ordinary effects stay
blocked throughout the overlay.

Reconciler precedence is deterministic: removed tombstone, local revocation block,
explicit/security/custodian pause, missing authorization, recoverable health error,
missing required configuration, outstanding initial consent, missing prerequisites,
then active after validation. It cannot infer grant validity from a UI badge.
Credential decryption failure is a local key/data problem and reports degraded
with blocked effects, not a fabricated upstream revocation. An unresolved remote
revocation incident survives local removal as an operational fact.

| Reconciliation scenario                                    | Required state/outcome                                                                                                                                                                         |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1: Slack OAuth succeeds without selected channel          | `configuring`; show finish-setup in FA/DE/EN, never a completed notification capability.                                                                                                       |
| L2: Rate limit/outage after previously successful check    | `degraded`, preserve last successful check time, obey retry-after/limits. Recovery can restore active only with unchanged valid authority/resources.                                           |
| L3: Upstream denies refresh permanently                    | `reauthorization-required`; stop sends and automatic refresh loops. Existing queued work needs fresh authority after reconnect.                                                                |
| L4: Disconnect while provider revoke is unavailable        | Atomically block local grants first, enter `revocation-pending`, retain only encrypted retry material. Retry success goes to removed; no ordinary credential consumer bypass.                  |
| L5: Stale successful health probe returns after pause      | Record bounded historical check evidence, retain `paused` and its hold/revision. No auto-resume.                                                                                               |
| L6: Same-account reconnect succeeds after channel deletion | Keep connection identity, replace credential generation, enter `configuring` until channel is explicitly selected again. Never match a new channel by old display name.                        |
| L7: Reconnect callback returns after removal               | Reject stale attempt, retain `removed`, destroy staged material, preserve safe audit attribution.                                                                                              |
| L8: Credential key unavailable after restart               | `degraded` with stable local diagnostic; no destructive token clearing or invented user-consent error. Correct-key recovery may restore prior state after authorization checks.                |
| L9: Custodian offboarded while provider health is good     | `paused` for custodian recovery. Provider success cannot substitute for active local stewardship.                                                                                              |
| L10: Imported content remains after disconnect             | Connection becomes removed while content follows its declared retention/privacy policy. UI explains that disconnect does not delete already sent remote content or silently purge CRM records. |

Existing UI `connectionState` maps provider setup, connected, needs-attention and
revocation-pending into presentation states
(`src/features/integrations/connectionState.ts:11-67`). Existing Slack disconnect
already blocks local ordinary use before remote revoke
(`src/features/integrations/service.ts:178-207`). Preserve that property while
adding the richer persisted state machine. A provider catalog entry, connected
badge, configuration screen or simulator result is not live-provider support.

## 7. Design acceptance and implementation handoff

| Task     | Review evidence supplied here                                                                                  | Runtime work still required                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| ARCH-001 | Entity model, immutable/revision rules and I1-I8 reconnect/duplicate scenarios.                                | CONN identity schema, upgrade/recovery, callback/refresh concurrency tests.                     |
| ARCH-002 | Operation ownership matrix and O1-O10 personal/shared authorization scenarios.                                 | Shared delegation, explicit transfer, offboarding integration and bounded metadata DTOs.        |
| ARCH-003 | Finite vocabulary families, no implicit expansion and C1-C5 policy examples.                                   | Enumerated registry, operation mappings, consent UI and provider capability adapters.           |
| ARCH-004 | Server evaluator seam, predicate, enforcement boundaries and N1-N14 negative review.                           | AISEC/CONN/API/SDK transport/job enforcement and real-DB adversarial matrices.                  |
| ARCH-005 | All nine lifecycle states, guarded transitions, reconnect overlay, precedence and L1-L10 reconciliation cases. | Persisted state machine, reason IDs, jobs/retry reconciliation and localized UI/operator flows. |

Review these scenarios against the current source audit before closing the design
tasks. Later implementation tasks require their own failing/passing tests and
exact-head evidence. Live-provider authorization, public hosting and publication
retain their separate selected-resource and approval gates. Nothing in this
record authorizes messages, provider installs, credential creation or deployment.

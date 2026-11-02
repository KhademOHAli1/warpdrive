# Client identity, extension isolation and release contracts

Decision record for ARCH-008 through ARCH-012, reviewed on 31 October 2026. Inspected application
source: `3d653a70884fdc384ec38aefef0d2636a5431c30`. Installed dependencies: Bun `1.4.4`,
`@modelcontextprotocol/server` `2.4.0`, `mcp-handler` `2.3.0`. These are local architecture
decisions and source findings. They do not implement the later AISEC, MCP, SDK, API or release
work and do not claim external client conformance or an operational app sandbox.

## ARCH-008: public clients and identity

### Protocol review and exact sources

The plan's pinned [MCP authorization revision, 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
was retrieved successfully on the review date. The unversioned `latest` URL redirected to that
same revision. There was no failed retrieval or substitute revision. Its HTTP authorization
profile requires protected-resource discovery, resource-bound bearer access, and resource
indicators in authorization and token requests. It recommends minimal scopes; a transport
capability declaration does not grant CRM authority. This is the target authorization profile,
not a claim that the current application satisfies every requirement.

The pinned [client-registration section](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration)
orders client choices as available pre-registration, advertised Client ID Metadata Documents
(CIMD), then dynamic client registration (DCR) fallback. CIMD uses an HTTPS client identifier
with a path, a matching document identifier, required metadata and validated redirect URIs.
DCR remains optional, deprecated compatibility support. Static/DCR credentials bind to the
issuing authorization server. The project decision is to support these as distinct identity
methods, with separate evidence, rather than equating a display name with publisher identity.

The pinned [authorization security section](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations)
requires audience validation, PKCE and public-client refresh-token rotation. It warns about
metadata-fetch SSRF and localhost impersonation, permits domain trust policies and requires
visible redirect hostnames. Upstream provider credentials are separate from the client's MCP
token. Those requirements inform the fail-closed cases below; the concrete local trust and
fetch policies are project decisions.

### Installed implementation, including both wire eras

| Source evidence                                                                                            | Current behavior and practical limit                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/oauth/clients.ts:89`, `:102`; `src/app/oauth/register/route.ts:13`                           | Custom DCR accepts name/redirects and stores a generated UUID client ID. JSON validation, rate limiting and name sanitation exist. No CIMD resolver or verified publisher is established by this path.                                                                                                                                            |
| `src/features/oauth/metadata.ts:9`; `src/config/env.ts:69`                                                 | `OAUTH_REGISTRATION=open` advertises DCR; `disabled` removes its advertised endpoint and rejects new registration. This is a registration switch, not an administrator allowlist for existing clients. CIMD support is not advertised.                                                                                                            |
| `src/app/oauth/authorize/route.ts:54`, `:124`; `src/features/oauth/authorize.ts:13`                        | Exact registered redirect matching and S256 PKCE binding exist. `scope` and `resource` parse as optional request fields, but consent/code issuance does not persist either as a grant restriction.                                                                                                                                                |
| `src/features/oauth/exchange.ts:11`, `:71`; `src/features/oauth/tokens.ts:38`, `:62`                       | Token exchange accepts but does not evaluate the requested resource. Issued access tokens have fixed `/api/mcp` audience, and inbound verification checks that audience and issuer. Refresh tokens rotate and remain client-bound. Audience checking must be preserved; it does not close request-resource validation or fine-grained grant work. |
| `src/features/mcp/auth.ts:34`; `src/features/mcp/http.ts:33`                                               | Application code verifies the token and current CRM actor; `AuthInfo.scopes` is currently empty. There is no implemented read-only grant vocabulary to infer from annotations or consent wording.                                                                                                                                                 |
| `src/app/oauth/authorize/consent.tsx:31`                                                                   | Client names are explicitly self-reported, with the redirect host/scheme and consent warning displayed. Preserve that truthful treatment.                                                                                                                                                                                                         |
| `node_modules/mcp-handler/dist/index.js:197`, `:707`                                                       | Adapter delegates HTTP handling to SDK `createMcpHandler` with `legacy: "stateless"`; auth wrapper calls the application verifier, checks configured scopes/expiry and passes `authInfo`. It does not supply the application's authorization server, CIMD resolution or app trust policy.                                                         |
| `node_modules/@modelcontextprotocol/server/dist/src-DdvbAHrR.mjs:562`; `dist/index.mjs:1112`, `:1206`      | SDK has an explicit modern `2026-07-28` revision and per-request handler/discovery path. It sets the classified revision and installs modern handlers. Modern support exists in the inspected source.                                                                                                                                             |
| `node_modules/@modelcontextprotocol/core/dist/schemas-DscsoNZN.mjs:4`; server `dist/mcp-oHn3ureC.mjs:1167` | Separate legacy `initialize` vocabulary lists `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`, `2024-10-07`. These legacy constants are not the complete modern support list.                                                                                                                                                              |

`src/features/oauth/clients.ts:42` also accepts safe private-use redirect schemes beyond
HTTPS/loopback, while the pinned security profile specifies localhost or HTTPS redirects.
Treat any retained native custom-scheme compatibility as a documented legacy exception with
its own host evidence; do not advertise strict 2026 authorization conformance for that path.
The current registration schema also does not model OIDC `application_type`. Review a client's
actual redirect/application profile before adding an OIDC-compatible registration claim.

The SDK's modern transport implementation and its OAuth metadata schema do not implement
Warpdrive's custom client-registration policy automatically. Maintain a test matrix for modern
per-request discovery/calls and selected legacy stateless initialization/calls independently.
The package version, a successful legacy test, or an OAuth grant is insufficient to qualify a
real host. No new host-specific packaging or UI support is asserted by this review.

### Selected trust policy

| Method                                     | What is established                                                                                                 | Selected admission and consent policy                                                                                                                                                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTPS CIMD                                 | Retrieved document is controlled at its HTTPS identifier; exact identifier and registered redirect set are checked. | Preferred new public-client path once implemented. Preserve identifier bytes, source method, metadata digest and fetch expiry. A verified metadata location is not a verified executable binary, corporate publisher or proof of a localhost listener's ownership.                        |
| Legacy DCR                                 | Server-issued UUID identifies a stored registration; client name and submitted redirect set are self-reported.      | Preserve existing integrations and explicit `open`/`disabled` setting. Do not silently rename/rebind grants to a similarly named CIMD client. Introduce bounded retention/abuse controls without breaking known clients by implication.                                                   |
| Administrator pre-registration / allowlist | Local administrator approves an exact issuer/client identity and redirect policy.                                   | Add as an explicit administrative policy with audited changes and fresh authentication. Match issuer, registration method and exact client ID; never a display name, icon or substring domain. Approval permits consent, not CRM access without the user's grant and current permissions. |

A CIMD fetcher must validate an HTTPS URL with a path and no credentials/fragment, bound its
response bytes and time, reject private/loopback/link-local/metadata destinations and DNS
rebinding, and reject redirects for the first supported implementation. Cache according to
validated cache policy with a local maximum TTL. Refresh failure must not add redirects or
permissions. Parse required fields at this boundary and compare `client_id` exactly. These
fetch restrictions are local implementation choices requiring tests, not claims about an
already installed resolver. Native loopback redirect support is reviewed separately from
fetch destinations; it never permits fetching metadata from loopback.

Metadata changes to redirect destinations require a new reviewed metadata revision and explicit
consent before use. A changed domain or client identity creates a new registration and grant.
A change in self-reported labels alone neither transfers trust nor widens capabilities. Emit
issuer identification in authorization responses and advertise it only after the corresponding
positive/negative conformance tests pass.

New scoped clients will request the smallest useful read set and require explicit additional
consent for writes/outbound actions. Existing broad grants remain accurately labelled until
AISEC's tested migration/reconsent path exists; this design does not retroactively claim they
are read-only. Registration, consent, code exchange, refresh, every MCP request and every delayed
effect must intersect current actor permissions, explicit grant capabilities and any app role.
Administrator restrictions must apply at those boundaries, including existing tokens.

Protocol review cases for implementation:

| Case                                                                                                          | Required result                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DCR name says a trusted publisher; attacker controls destination                                              | Self-reported identity remains visible; no verified badge or automatic grant.                                                                                                                     |
| CIMD has wrong `client_id`, forbidden network target or redirect fetch                                        | Reject before consent/token issuance; no internal fetch or broad fallback.                                                                                                                        |
| Legitimate CIMD with only localhost redirects                                                                 | Show destination and impersonation warning; do not imply that HTTPS metadata authenticates the local process.                                                                                     |
| Registration disabled but old UUID exists                                                                     | New DCR is refused; existing behavior follows its recorded grant and explicit client policy, not an invented allowlist.                                                                           |
| Administrator removes a client after consent                                                                  | Subsequent exchange/refresh/request/effect is denied under current policy; no stale token bypass.                                                                                                 |
| Requested `resource` differs from `/api/mcp`, or mandatory resource is omitted in the selected strict profile | Reject with the appropriate protocol error before issuing a token. Keep any explicitly supported legacy transition distinct and tested.                                                           |
| Modern client vs legacy client                                                                                | Exercise each supported wire path, discovery, PKCE, redirect, issuer, audience, refresh/replay and revocation. Unsupported profiles fail clearly; no compatibility claim from SDK presence alone. |

## ARCH-009: extension execution boundary

Decision: built-in provider adapters are trusted application code reviewed and deployed with
the host. Installed third-party applications are untrusted. Their Bun-compatible logic runs
in a separate OS/container sandbox on a pinned Bun `1.4.4` execution image initially. Bun worker
threads, dynamic imports, JavaScript realms and a same-user child process without OS restrictions
do not satisfy this boundary. The current local S3 container does not demonstrate app isolation.

Select a rootless Linux container/VM execution profile as the reference qualification target.
On macOS, the container VM is part of the boundary and must be identified in the support record.
Unqualified platforms refuse untrusted execution. This choice requires SDK implementation and
measured adversarial tests before any installation is described as safe or supported.

The sandbox has a non-root identity, no privileged mode, no host or Docker socket mount, a
read-only image/package filesystem, a small separate temporary filesystem and no direct host
filesystem, PostgreSQL, queue, object-store or application-session access. Package archives are
validated before extraction; host-side install scripts and arbitrary package lifecycle hooks
are never executed. Dependency acquisition/build occurs in a bounded isolated builder with
recorded lockfile, checksums, licenses and output provenance.

| Threat                                            | Required boundary and negative demonstration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reading host credentials, files or cloud metadata | No host env/config/credential mounts. Package probing of host paths, parent process state and metadata endpoints fails. Logs never contain provider tokens.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Using the broker as a deputy                      | Broker binds a short-lived invocation credential to installation, pinned app version, explicit `executionActorId` and its grant, capability set, selected resources, connection generation and expiry. It rereads current authority for each action. The initiating/event actor is separate audit provenance and never substitutes for execution authority. For an event caused by A and authorized as rule owner B, bind the invocation to B and B's grant; carry A only as provenance. Swapped principal/grant, forged installation/resource IDs and revoked grants fail. |
| Direct network escape or DNS rebinding            | Network denied by default. Only the broker can call approved provider adapters. A future explicit app egress permission requires destination/port allowlists, DNS/IP checks, TLS verification, redirect policy and byte/time limits.                                                                                                                                                                                                                                                                                                                                        |
| CPU, memory, fork, disk or output exhaustion      | Enforce per-invocation wall/CPU time, memory, PIDs, scratch bytes, request/output sizes and per-installation concurrency/queue budgets. A shared-service overload cannot grant more resources. Timeout/cancel kills the process group/container and accounts for any possible external outcome.                                                                                                                                                                                                                                                                             |
| Stale delayed work after disable/uninstall        | Stop admission immediately, revoke invocation authority, fence queued/in-flight work by generation, terminate execution and retain audit/outcome records. An already accepted provider side effect is reconciled rather than silently retried.                                                                                                                                                                                                                                                                                                                              |
| Malicious UI steals session or forges an action   | Never load app JS with host DOM/session authority. Use an isolated origin/sandboxed renderer or reviewed remote-component bridge. Broker validates origin, source window, nonce, message schema, installation and current action permission; unknown messages and arbitrary HTML/JS are rejected.                                                                                                                                                                                                                                                                           |
| Unsafe update changes permissions or migrations   | Pin installed versions. Diff requested capabilities/egress/schema, require reviewed consent for expansion, isolate migrations and preserve tested recovery boundaries. Publisher identity alone never authorizes expansion.                                                                                                                                                                                                                                                                                                                                                 |

Provider secrets remain encrypted in the host credential service. The app receives opaque
connection handles and safe result DTOs, not OAuth tokens, SMTP passwords, database credentials
or host environment values. The broker enforces the capability vocabulary from ARCH-003 and the
shared server evaluator from ARCH-004, not a second permission model. Quotas and egress are
server policy; a manifest cannot raise them. A global kill switch and per-installation disable
must work when app code is unresponsive. Record runtime/image version, boundary configuration,
resource measurements and cleanup evidence in every qualification run.

## ARCH-010: version and migration policy

Version independently: public API contract, event payload, provider adapter, workflow action,
SDK manifest, app package and broker protocol. An app's package semver is not its API/schema
version. Persist exact selected versions, not `latest`, on connections, definitions,
subscriptions and installations. Store wire/storage values independently of translated labels.
Keep Iranian authored recurrence, date-only values and UTC instants distinct; version migrations
cannot silently reinterpret one as another.

Existing precedents are `src/server/ws/payload.ts` with envelope `v:1`,
`src/features/workflows/schemas.ts:34` with definition `schemaVersion:1` and node `version:1`,
and immutable publication in `src/features/workflows/persistence.ts:83`. Reuse these boundaries;
this decision does not change their current schemas.

Selected compatibility window: after a successor major contract is generally available, retain
the preceding supported major for at least 180 days and two published minor releases, whichever
is longer. Count from actual successor availability, not this design date. Publish the removal
date and migration route before starting that window. A security emergency may shorten it only
with an explicit advisory, impact record and operator recovery path. No currently unpublished
API is promised a historical support window.

| Example                                                                       | Compatibility decision                                                                                                                                                                                 |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Add optional `displayName` to deal event v1                                   | Readers ignore unknown response fields; producers preserve stable IDs. Contract tests cover old readers and new payload. Do not silently add secret or newly sensitive fields.                         |
| Change deal `amount` from decimal string to floating number                   | Breaking semantic change; reject it. Retain exact decimal strings or introduce a reviewed v2 representation with explicit migration. No locale-dependent numeric wire format.                          |
| Workflow action v1 creates undated self-tasks; v2 supports assigned/due tasks | New action version with explicit permissions and temporal inputs. Existing published runs remain pinned to v1. Do not rewrite immutable definitions or expand old authority.                           |
| Provider API deprecates a field or cursor                                     | Pin adapter/API profile; migrate the checkpoint with a bounded rebuild/conflict strategy. Mark degraded/reauthorization when necessary; never treat a reset as permission for historical bulk effects. |
| App manifest v2 adds outbound mail                                            | Installation stays on approved version until permission diff/reconsent and local tests pass. v1 cannot gain the new action through a silent package update.                                            |
| Add a database column                                                         | Use expand, bounded backfill, validation, then a separately gated contract step. Test clean install and an upgrade with old data; preserve IDs, ciphertext/key identity and queue references.          |

Expose stable machine error IDs, correlation IDs and version metadata with safe DTOs. Document
REST version selection and GraphQL field evolution when API tasks implement those interfaces;
unsupported versions fail with a stable error and supported alternatives. Deprecation notices
appear in developer docs, machine-readable capability/manifest metadata and contextual FA/DE/EN
operator/UI messages. API responses may carry standardized deprecation headers once that
interface is implemented and tested. Never remove a field solely because the UI stopped using it.

Database migrations are append-only once applied. Backups, key references, preflight/dry-run,
transaction boundaries, resumable backfill and a tested restore/roll-forward path accompany
schema changes. Do not promise reverse migration after destructive changes. Persisted queued
events and paused app versions require compatibility readers until drained, expired under an
explicit retention policy, or migrated with evidence. Old/new app versions and failed migration
recovery are separate PostgreSQL acceptance scenarios.

## ARCH-011: finite actual-provider delivery gates

Local engineering, PostgreSQL tests and explicitly labelled provider simulators proceed under
LOCAL PREVIEW. They do not wait for unrelated provider approval, a domain choice or publication.
Each provider/client has its own later gate; one provider's missing account does not block a
different track. No resource, account, scope, vendor decision or approval is invented here.

Before an actual-provider test, attach a reviewable run record containing:

| Required field           | Gate rule                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider/client profile  | Exact provider/API/host version, account type, tenant/edition/entitlement and supported operations. Record actual account identifiers privately and use redacted references in evidence.                                                                                                                          |
| Destination and callback | Use the user's supplied deployment/callback domain only if the scenario requires it. Verify actual TLS, trusted origins, discovery and registered callbacks there. A permitted desktop loopback flow can have its own qualified profile. A `.invalid` build value or invented domain never qualifies live access. |
| Authority                | Record account owner, connection owner, exact reviewed scopes/resources, actor role and the authorization covering finite actions. Existing local-development permission is not permission to send real messages, invite guests, place calls, publish apps or incur charges.                                      |
| Bounds                   | List synthetic record IDs/test recipients, exact permitted operations, maximum counts/cost, time window, cancellation, retry/idempotency rules and forbidden production/customer data. Validate prerequisites before consent or side effects.                                                                     |
| Evidence                 | Exact source/build/config profile references, commands, response/error codes, timestamps, provider request IDs and observed outcomes. Keep secrets, message bodies and private account data out of source/log exports.                                                                                            |
| Recovery and cleanup     | Disconnect/revoke grants, remove test subscriptions/files/events/apps, reconcile accepted/unknown effects, restore changed configuration and prove cleanup. Record retained external content or manual provider cleanup explicitly.                                                                               |

Finite scenario examples, all conditional on their actual supplied resources:

- Slack: one approved test workspace/channel and synthetic deal. Install minimal reviewed
  scopes, preview one link-only notification, deliver it once, observe actual upstream outcome,
  exercise controlled permission/revocation failure and remove the test installation/content.
- Calendar/conferencing: one test calendar/organizer with approved test guests if invitations
  are explicitly included. Create/edit/cancel one timed and one all-day event, exercise one
  reviewed recurrence and conference lifecycle, inspect remote state and remove residual data.
  Saved CRM events or plausible meeting URLs do not establish invitations or provisioning.
- MCP client: one actual chosen host/profile. Complete consent, demonstrate allowed read,
  denied write for a read-only grant, separately approved write, refresh and revoke. Verify
  fallback/embedded UI only where claimed for that host. A generated client package closes
  packaging work only.
- Mail or another independently selected provider: use the peer-owned adapter contract and a
  named permitted account, with explicit message/action limits and delivery/unknown-outcome
  reconciliation. No shared gate authorizes an unsolicited message or a new vendor choice.

A failed or unavailable live gate leaves that scenario unqualified and its release claim open.
It does not convert simulation into provider evidence, roll back unrelated local work, or make
all local dependencies wait on that external resource. Public hosting and publication remain
separate stage records even after a provider test passes.

## ARCH-012: dated capability parity and truthful claims

Comparison date: **31 October 2026**. Twenty's official pages were retrieved on that date;
they describe its product, not an independently benchmarked installation. They provide the
capability reference. Warpdrive's design and runtime target remain its own single-tenant,
Bun-compatible system. Do not copy another platform's implementation assumptions as proof.

| Dated capability reference                                                                                                                                      | Warpdrive path and present claim boundary                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Twenty mail/calendar](https://docs.twenty.com/getting-started/core-concepts/calendar-and-email): mailbox/calendar sync, multiple accounts and integration APIs | MAIL/CAL/provider tracks plus API. Local event editing and the peer independent-mail work are separate evidence; neither establishes every external account's sync compatibility.         |
| [Twenty workflows](https://docs.twenty.com/getting-started/core-concepts/workflows): record/manual/schedule/webhook triggers and actions/variables              | Existing manual workflow engine is reused for EVT/AUTO. Automatic events, waits and provider effects require their own qualified increments; registry entries are not executable support. |
| [Twenty apps](https://docs.twenty.com/getting-started/core-concepts/apps): extension data/logic/UI/AI contributions and private/public distribution             | SDK/STORE target those capability families with the isolation contract above. A directory/roadmap or package generator does not establish an app runtime or marketplace.                  |

Parity means a named user workflow completes with its permission, recovery, language and
operational contract, compared at a recorded date. It does not mean every Twenty feature,
provider, plan tier, performance envelope, interface or security property is identical. Recheck
the source comparison and real workflow at each claimed public release.

| Evidence stage         | Permitted wording and limit                                                                                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source/design          | “Implemented in source” or “contract selected”, with exact head and missing checks. Never “connected”, “delivered” or “supported” from a catalog entry.                                                                 |
| Local qualification    | “Passed local simulation/real-PostgreSQL/service checks” with named profile/scenarios. Local S3 or provider simulation is explicitly labelled.                                                                          |
| Actual provider/client | “Validated on [exact provider/account/client profile] for [finite scenario]”, with date and cleanup. Do not generalize to all tiers or hosts.                                                                           |
| Supported release      | Versioned artifact plus relevant current local/provider/deployment, restore, localization and operator/support evidence. List compatibility limits and named maintenance ownership; missing release gates stay visible. |
| Publication            | Record the actual destination, artifact digest/version, publisher and rollback/support route. Publication does not by itself establish functional compatibility.                                                        |

Copy must preserve natural Farsi first, German and English throughout consent, permission diffs,
errors and operator recovery. Respect independent language, numbering, Iranian/Gregorian calendar
and timezone preferences. URLs/IDs stay directionally isolated. Planned, locally tested,
provider-validated and released states must use distinct labels in every language.

## Review result and implementation gaps

This review selects client trust modes, OS isolation requirements, compatibility policy, finite
external gates and dated parity wording. Its negative cases provide the design-review evidence
for ARCH-008 through ARCH-012. No external acceptance, independent security certification or
production implementation is implied.

Follow-up implementation gates remain explicit: CIMD/allowlist and strict resource/issuer cases
in AISEC/MCP; sandbox/broker/UI escape tests and measured quotas in SDK; versioned API contracts
and migration/recovery fixtures in API/QA/OPS; finite actual-provider/host qualification in each
provider track; release support and publication evidence in OPS/OSS/STORE. No production source,
private configuration or execution register was changed by this document's author.

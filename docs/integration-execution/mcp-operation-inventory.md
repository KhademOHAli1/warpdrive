# AISEC-001: current MCP operation inventory

Historical baseline: committed `643738bdba1e7aba8b414a98dc0b6cdc9c17a361`,
reviewed 1 November 2026. Its original review evidence and limitations remain recorded
below and at that immutable commit.

Current-source reconciliation on 2 November 2026 uses committed
`cc6268266885f215e357d440523e9f9dec9cb0a1`. It updates source-proven authority,
projection, notification-delivery and OAuth deltas while retaining the exact same
operation identities. A CSV row's `source_commit` is its last source-review cut:
changed rows name the current cut; unchanged classifications retain the historical
cut. Source pointers on unchanged rows remain references to that cut, not newly
executed evidence. The original AISEC-001 scope remains classification by domain,
read/write, outbound effect, ownership and visibility requirements. Formal acceptance
follows the existing delivery procedure; this update does not record human acceptance.

The accompanying [CSV](mcp-operation-inventory.csv) contains 58 individually
identified rows: **35 application tools (17 read, 18 write)**, eight SDK/control
operations, two app HTTP exports, seven explicitly absent resource/prompt method
markers, and six adjacent OAuth routes. Absent markers and adjacent routes are
not additional registered tools. The CSV records actual shared handlers,
ownership/visibility policy, indirect effects, credential access, source pointers
and limitations per operation. Stable registered names are preserved verbatim.

The historical review ran only source reads and bounded Python/text cross-checks. It ran no
Bun, tests, app, build, types, lint, install, PostgreSQL, browser or network
campaign. The current refresh also checks documentation formatting and source anchors;
these are not application or provider qualification. Public/prod configuration and
private environment values were not read.
Installed SDK implementation references below are tied to committed package pins:
`@modelcontextprotocol/server` 2.4.0 and `mcp-handler` 2.3.0 (`package.json:48`,
`:84`; `bun.lock:491`, `:1671`). They are dependency-source evidence, not observed
protocol compatibility or an external client's acceptance.

## Registration, discovery and authentication

`src/features/mcp/server.ts:9-18` unconditionally composes read and write
registries. `tools/reads.ts:40-42` plus `:137` registers the main and email reads;
`tools/writes.ts:9-15` registers deal/lead, contact, activity/note and draft writes.
The six leaf registration files contain exactly 35 literal names. There is no
application role-, provider-, feature- or grant-based per-tool registration filter.
An absent actor mailbox can make draft creation fail; it does not hide that tool.
Local drafts can still use an owned paused/disconnected mailbox, while remote send
admission remains separate. Installing an integration does not dynamically add tools.

The app ignores SDK registerTool handles (`tools/types.ts:76-93`). The installed
SDK defaults handles to enabled and supports enable/disable; tools/list filters
those handles and tools/call rejects missing/disabled names
(`node_modules/@modelcontextprotocol/server/dist/mcp-oHn3ureC.mjs:1584-1606`,
`:1945-1948`). The app invokes no such toggle. Thus its registered discovery set
is the same 35 names for an authenticated member and administrator; handler
permissions can still reject an advertised operation.

`src/app/api/mcp/route.ts:9-14` supplies nodejs GET and POST exports, both guarded
by `MCP_ENABLED`. False produces 404. There are no application DELETE, OPTIONS or
HEAD exports here; framework defaults are not qualified by this inventory.
`src/config/env.ts:61-69` defines MCP enabled by default and independently open or
disabled OAuth client registration. These are schema defaults, not assertions
about a running deployment. Open dynamic client registration means a new OAuth
client row, not dynamic MCP tool registration.

`mcp/http.ts:11-18` first requires the supplied and configured resource profiles
to agree, then verifies each HTTP request with its abort signal and timeout.
`mcp/auth.ts:21-48` validates the configured target, verifies the resource-bound access
token and hydrates the actor; `authInfo.resource` identifies the MCP resource while
`scopes` remains empty. `oauth/tokens.ts` checks signature, configured issuer, MCP
audience, expiry, revocation and subject binding. Even a read/discovery request
**writes access-token lastUsedAt**. This authentication bookkeeping is separate from
the selected domain tool's read/write classification and does not add granular grants.

The request context is captured in the handler closure (`mcp/http.ts`, `requestContexts`).
`getToolActor` only checks for a non-null snapshot (`tools/types.ts:50-53`).
`actorContext.ts:25-30` assigns `mcp:<actorId>` as a synthetic session identifier;
it is not a native cookie or native session row. Native issuance-session checks
in OAuth authorization are not per-tool fresh-authentication/MFA checks.

All tool inputs pass the registered Zod object before the handler. Results become
text JSON plus the same structured data (`tools/types.ts:30-33`, `:66-93`).
Annotations are name-derived hints, not capabilities: readOnly/idempotent cover
read names; archive_lead and delete_email_draft are marked destructive. The
openWorldHint=false value does not undo internal jobs or HTML URLs returned by a
handler. toolError renders AppError/TRPC/Zod messages (`:36-43`); this is not a
blanket error-message or credential-redaction qualification.

## Actual authority and effect matrix

Retained G-codes preserve historical identity. Resolved items are explicitly marked; a code is not a claim that all of its old findings remain open.

The CSV is the operation-level matrix. These group notes explain cross-cutting
semantics that a short tool label would hide.

| Surface                            | Actual shared authority                                                                                                                                                                                                                                                                                                                                                    | Effects beyond the obvious record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search and CRM reads               | tRPC protected context plus feature SQL/canSee. Search independently filters deals, people, organizations and leads (`search/query.ts:48-154`). Lists/details use their feature routers/repos named in the CSV.                                                                                                                                                            | Record/count/aggregate/definition/label projections. They are data extraction even though no CSV-export tool exists. Linked projections have the G6 limits below.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Pipeline reads and summary         | Nonarchived pipeline group membership/admin (`pipelines/pipelineRouter.ts:17-46`); stats owner scope clamps to self without stats.viewOthers (`stats/ownerScope.ts:7-10`) and pipeline/record filtering follows (`stats/router.ts:32-78`).                                                                                                                                 | Summary reads several deal/activity aggregates; it is not a single pipeline row or an unrestricted team-wide report.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Deal create/update/move            | create needs deal.create/admin, derives owner/group and validates pipeline/references (`deals/dealActions.ts:46-184`; `permissions/entityCreate.ts:24-60`). update rehydrates at its transaction checkpoint; move uses supplied actor with loadEditableDeal (`deals/dealUpdate.ts:84-179`; `dealMove.ts:17-112`).                                                          | Labels/catalog links, CAS, audit and PostgreSQL realtime publication. MCP calls these domain services directly; it does not invoke the server action's after-response notification wrapper.                                                                                                                                                                                                                                                                                                                                                                                             |
| Lead create/update/archive/convert | Create/convert require deal.create/admin. Update/archive and conversion additionally require canLeadAction(deal.edit); update/archive reapply ownership/action predicates in UPDATE, with updatedAt CAS for update. Owner transfer remains separately gated (`leads/leadActions.ts`, `leadUpdate.ts`, `leadConvert.ts`, `leadWriteAuth.ts`).                               | Conversion creates a deal, archives/stamps the lead, copies notes/activities/guests/participants, links email threads, syncs labels and writes audit/realtime. Target-pipeline admission runs before conversion and again with a transaction lock; the actor-snapshot and carry-over limits in G2/G7 remain. This is not a one-row move.                                                                                                                                                                                                                                                |
| Contact writes                     | The MCP create_person/create_organization wrappers now require can(contact.create), then derive actor ownership and visibility; person creation checks its organization reference. Updates retain canSee plus can(contact.edit), with separate ownership transfer (`mcp/tools/writes-contacts.ts`; `contacts/personsRepo.ts`; `orgsRepo.ts`).                              | Custom fields, name/email derivation and label links. No provider enrichment/network lookup is invoked. The explicit MCP create gate does not imply a new client-grant system or that every direct domain caller has the same wrapper.                                                                                                                                                                                                                                                                                                                                                  |
| Activity and note writes           | The MCP create_activity wrapper requires can(activity.create), followed by existing reference/actor checks. Update/completion retain canSee plus can(activity.edit/complete), including the visible-assignee exception. Notes retain visible-parent/actor-derived-author rules (`mcp/tools/writes-activities.ts`; `activities/repo.ts`; `collaboration/notesRepo.ts`).     | Guest/participant rows and linked deal-date recomputation. Postcommit reminders can create notifications and preference-gated email. Current notification preparation binds an immutable send purpose/outbox attempt to an eligible recipient Gmail or SMTP mailbox; runSendJob applies current admission and provider-specific delivery (`notifications/email/notificationBinding.ts`, `notificationBindingRows.ts`, `notificationDispatch.ts`; `email/worker.ts`). This is conditional recipient notification, not arbitrary-recipient send or a grant-aware MCP outbound capability. |
| Email reads                        | canSeeEmail retains mailbox-owner access, no nonowner admin bypass for private messages, and shared access through a visible linked deal OR person (`email/emailVisibility.ts`).                                                                                                                                                                                           | get_email returns sanitized stored HTML plus attachment/tracking metadata and the current delivery-report/private-intake metadata projections (`messageReads.ts`; `deliveryObservationMessageRefs.ts`; `privateIntakeProjection.ts`). No attachment bytes or provider fetch is invoked by that read; remote-image URLs can still be retained for later host rendering.                                                                                                                                                                                                                  |
| Draft reads/writes                 | Draft SQL remains mailbox-owner scoped. Creation selects the actor default/send-preferred mailbox and saveDraft rechecks active noninvited owner, account custody and a transaction-fresh actor before shared CRM-link visibility checks. Patch/delete retain owned-draft SQL (`mcp/tools/writes-email.ts`; `email/mailboxOwnership.ts`; `draftRepo.ts`; `draftLinks.ts`). | Local unsent insert/patch/delete only; plaintext is converted to paragraph HTML. Content-only patch retains existing links/thread/privacy. Local draft availability is independent of remote connection/send capability; these handlers do not send, schedule or retrieve provider content.                                                                                                                                                                                                                                                                                             |

can/canSee are current CRM policies, with inactive-before-admin and record-specific
visibility/ownership behavior (`permissions/can.ts:35-64`, `canSee.ts:5-40`). They
must not be re-described as an already implemented client capability or app-role
intersection. Ownership-transfer authority is also distinct from ordinary edit:
create deal/lead owner overrides and contact/lead ownership edits need their
actual current transfer policy, not a proposed consent write label.

## Current boundaries and retained gap identifiers

| Code | Source-observed boundary or missing check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1   | OAuth grants remain broad: scopes:[] is not a granular CRM capability/app-role/resource selection. Current auth also binds the configured MCP resource/audience/issuer; that server target binding is not a per-client read-only ceiling (`mcp/auth.ts`; `oauth/resource.ts`; `db/schema/oauth.ts`).                                                                                                                                                                                                                                                                                                                                                                                                                      |
| G2   | Actor/token validity is checked per HTTP request, then most role/group/visibility context is a snapshot. update_deal and saveDraft have bounded transaction-fresh actor checkpoints. These do not establish universal per-effect MCP-token/native-session revalidation or global revocation serialization.                                                                                                                                                                                                                                                                                                                                                                                                                |
| G3   | Every registered name is advertised independently of actor/grant authority. The readOnlyHint/destructiveHint/idempotentHint/openWorldHint fields neither authorize direct invocation nor filter discovery.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| G4   | The historical missing lead edit/archive gate is resolved for the named surfaces: update_lead/archive_lead require canLeadAction(deal.edit) and repeat the ownership predicate in their UPDATE; conversion also checks lead edit authority (`leads/leadWriteAuth.ts`; `leadUpdate.ts`; `leadActions.ts`; `leadConvert.ts`). Current affected rows no longer cite G4 as an open gap; actor/grant snapshot limits remain G2.                                                                                                                                                                                                                                                                                                |
| G5   | The historical existence-only draft-link check is resolved: saveDraft locks/rechecks active owner/account, rehydrates the actor and checks supplied deal/person links through shared visibility rules before storing them (`draftRepo.ts:43-106`; `draftLinks.ts:30-53`). Draft operations remain local and owner-scoped; a local draft does not certify remote provider connection/send authority. Content-only patch preserves existing context; it is not a new CRM-link mutation.                                                                                                                                                                                                                                     |
| G6   | The historical linked-contact projection gap is resolved at the inventoried get_deal/get_lead/list_deals/list_leads surfaces. Workspace results mask hidden person/org IDs and rows; SQL joins use independent contact visibility (`deal-workspace/summaryRepo.ts:163-200`; `deals/dealRepo.ts`; `leads/leadRepo.ts`; `contacts/visibilitySql.ts`). Current affected rows no longer cite G6 as an open gap; this is not a blanket proof for every projection.                                                                                                                                                                                                                                                             |
| G7   | convertLead calls admitPipelineWrite after resolving the target and repeats admission with a row lock inside the insert transaction (`leads/leadConvert.ts:159`, `:194`; `pipelines/admitPipelineWrite.ts:10-37`); existence, archived state and restricted-pipeline visibility are enforced. G2's actor snapshot limitation remains. History carry-over touches notes, activities, guests/participants and email links without per-child actor/mailbox-owner policy in that helper (`convertCarryOver.ts:18-107`). Copying activity rows does not establish a second reminder enqueue. A future policy mapping must not silently treat conversion as a simple lead write.                                                |
| G8   | Current MCP contact/activity creation wrappers now have explicit contact.create/activity.create checks. add_note retains visible-parent/actor-author checks without a separate note-create capability. Deal/lead create policy and server-derived visibility/group fallback remain as recorded; no new client-grant or fallback-membership proof is inferred (`mcp/tools/writes-contacts.ts`; `writes-activities.ts`; `contacts/visibility.ts`; `permissions/entityCreate.ts`).                                                                                                                                                                                                                                           |
| G9   | createActivity still commits before scheduleReminder; a postcommit enqueue failure can report an error after a durable activity exists, without a new MCP idempotency key/outbox. The later reminder may reach notification preparation, a durably bound send-purpose/outbox attempt and Gmail or SMTP transport. Recipient visibility/preferences, connected/unpaused send-capable mailbox selection and current worker admission gate it (`activities/repo.ts`; `notifications/email/notificationBinding.ts`; `notificationBindingRows.ts`; `notificationDispatch.ts`; `email/worker.ts`). Jobs carry activity/notification IDs, not the originating MCP grant; no granular outbound-capability enforcement is claimed. |
| G10  | SDK call signal +15s is composed at tools/types.ts:90-91 (direct test registry uses 10s). Several read handlers instead call tRPC routers that allocate independent signals; cancellation is not uniformly forwarded end to end. A timer is not proof of hard DB cancellation or CPU preemption. get_email sanitization is not tool-result-injection/capability enforcement.                                                                                                                                                                                                                                                                                                                                              |
| G11  | update_deal rehydrates its actor inside the transaction and uses it for group/edit/reference/audit/event checks. The original bounded PG16 evidence remains historical; current-main CI is separate evidence. This checkpoint does not recheck a native cookie/MCP grant, freeze later authority changes or change move_deal_stage. No invited-user policy expansion is claimed.                                                                                                                                                                                                                                                                                                                                          |

These seams inform AISEC-002 onward. None is repaired by this source inventory.
No new broker, lifecycle, event or capability service is assumed to exist.
add_note's collaboration domain label is an inventory classification, not an
invented ARCH consent scope. Its schema supports deal/person/organization/lead
parents and returns the newly created note body, pinned flag and actor-derived
author (collaboration/notesSchemas.ts:5-10; notesRepo.ts:12-14, :59-76). No current
registered read tool independently reads collaboration note bodies; get_activity
returns its activity.note field instead. Conversion copies notes internally and
returns a deal ID, not note bodies. The owning policy review must resolve any vocabulary
mapping before granting it in a new minimal profile.

## Protocol, absent surfaces and adjacent OAuth routes

The CSV names each operation below separately from tools. Installed SDK lines
refer to `node_modules/@modelcontextprotocol/server/dist/`.

| Family                                     | Current application/dependency source boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tools/list and tools/call                  | SDK dispatch is installed by tool registration (`mcp-oHn3ureC.mjs:1584-1606`). The app provides the 35 tool definitions and shared wrapper. Protocol dispatch is not a separate domain permission.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| initialize / server/discover / initialized | SDK owns handshake and modern discovery (`mcp-oHn3ureC.mjs:870-872`, `:1182-1190`). Legacy initialize and modern server/discover are profile-specific, not a blanket compatibility promise.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ping                                       | Inherited protocol control (`src-DdvbAHrR.mjs:6257-6263`); SDK notes its removal from the 2026 modern profile (`mcp-oHn3ureC.mjs:1267`). It is not a CRM tool.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| cancellation/progress                      | SDK handles known-request cancellation and progress plumbing (`src-DdvbAHrR.mjs:6257-6263`, `:6348-6350`). App tool callbacks receive the SDK signal. A new server/context per HTTP request does not establish cross-request cancellation.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Resources/prompts                          | No app registerResource/registerPrompt/explicit capability setup exists. McpServer is constructed without such capability options (`mcp/server.ts:15-18`); SDK installs these methods only when their registration/capability setup runs (`mcp-oHn3ureC.mjs:1523-1525`, `:1702-1707`, `:1759-1763`). resources/list/templates/read/subscribe/unsubscribe and prompts/list/get therefore have no application feature/callback here. No app completion, sampling, elicitation or roots-driven operation is registered or invoked.                                                                                                                                                               |
| Transport/session                          | App supplies GET/POST. mcp-handler selects legacy stateless fallback (`node_modules/mcp-handler/dist/index.js:197-207`); SDK legacy transport accepts POST and responds405 to GET/DELETE with no session ID generator (`node_modules/@modelcontextprotocol/server/dist/index.mjs:852-862`). This is source behavior, not a native socket/TLS/client run.                                                                                                                                                                                                                                                                                                                                      |
| OAuth metadata                             | GET `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` are gated public discovery documents. The current resource/issuer profile is configured server-side; authorization-server metadata advertises `authorization_response_iss_parameter_supported:true`. OAuth protected-resource JSON is not a registered MCP Resource (`oauth/metadata.ts`; `oauth/resource.ts`).                                                                                                                                                                                                                                                                                     |
| OAuth registration/authorization/token     | Registration remains independently disableable/rate-limited and creates a client, not tools. Authorization and every token ingress require exactly one explicit supported MCP resource before grant mutation. Validated approve/deny callbacks identify the configured literal issuer. Code exchange/refresh issue credentials; refresh reuse contains only the affected same-user/client successor chain, not independent grants (`app/oauth/authorize/route.ts`; `token/route.ts`; `oauth/requestIngress.ts`; `oauth/requestSchemas.ts`; `oauth/authorizationHttp.ts`; `oauth/tokens.ts`). These routes are adjacent to domain tools; no granular approved CRM capability set is persisted. |

The native appRouter contains import, files, enrichment, workflows, OAuth grant
administration and other routes (`server/trpc/root.ts:26-49`). Constructing a
server-side caller does not expose all of them through MCP: only the calls named
in the registered handlers are reachable as tools. There is no current direct arbitrary-recipient MCP send,
publish, Slack/connect/credential-management, attachment-download, import/CSV-export,
bulk-delete or job-control tool. Export-like data extraction through existing
reads and the indirect reminder/email/history effects remain in scope above.

## Mechanical reconciliation and evidence boundary

Bounded Python read committed source with git show, extracted literal name fields
from exactly the six leaf registration files, rejected duplicates and compared
both directions with CSV surface=tool names and server.test.ts EXPECTED_TOOLS.
Result: 35 unique registrations, 35 unique CSV tool rows, no missing/extra names;
17 read and 18 write. Non-tool rows are deliberately separate. This is a text
completeness check, not a TypeScript parser, loaded server or test execution.
Composition and every actual handler were also reviewed manually; labels alone
were not used to infer authority or side effects.

Existing source tests provide future invocation anchors, not new pass evidence:
server.test.ts:12-87 checks name/discovery sets; http.test.ts:32-131 contains
legacy/pinned SDK handler isolation, denied create and next-request token revoke;
tools/writes-email.test.ts and reads-email.test.ts cover mail privacy/ownership;
metadata.unit.test.ts covers annotations. These do not constitute an all 35
operation authorization matrix, a fine-grained read-only grant test or live
upstream/provider proof. The current actor regression's focused PG16 evidence is
kept distinct from its pending broader regression gate and any PG18 profile.

Before accepting a changed inventory, repeat exact-head name reconciliation,
review new/changed handler effects and policy seams, and preserve the difference
between source matrix, executed security regression, protocol compatibility,
provider acceptance and public/release qualification.

## Current reconciliation evidence

At `cc6268266885f215e357d440523e9f9dec9cb0a1`, bounded text reconciliation again
found 35 unique registrations, 35 CSV tool names and the same server-test expected
names, with no missing/extra names: 17 reads and 18 writes. All 58 rows retain their
surface/operation identity. Changed classifications are limited to the source deltas
above; unchanged rows retain their prior source cut and evidence limitations.

This reconciliation runs no application, tests, database, provider or client. Existing
exact-main CI is separate supporting evidence; it does not turn the inventory into an
all-operation invocation/authorization matrix. No frozen task/status ledger, scope,
grant, flag, schema or runtime code is changed by this documentation update.

## Historical independent inventory source review

Root and a separate source reviewer accepted the corrected matrix on 1 November 2026.
The reviewer checked all 35 registrations and actual handler paths. One blocking omission
was corrected before acceptance: activity reminders can conditionally reach Gmail delivery
and downstream recipient credentials. The correction also records that reminder job payloads
do not retain the originating MCP grant. This is an indirect-effect classification, not an
executed exploit or arbitrary-recipient send claim.

Root independently repeated exact-head name reconciliation and required-field checks:
58 nonempty rows, 35 unique tool names, 17 reads and 18 writes, with no missing or extra
registration. Source review acceptance satisfies AISEC-001's inventory criterion. It does
not repair the G1-G11 gaps, implement granular consent, establish invocation coverage or
qualify protocol/provider behavior. Task-status changes remain in the live register.

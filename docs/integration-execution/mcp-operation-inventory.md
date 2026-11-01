# AISEC-001: current MCP operation inventory

This is a source matrix for committed `643738bdba1e7aba8b414a98dc0b6cdc9c17a361`,
reviewed 1 November 2026. It addresses the exact AISEC-001 acceptance: "Classify
the existing tool surface by domain, read/write, outbound effect, ownership and
visibility requirements" (`docs/integration-execution/tasks.csv:122`). ARCH is
its foundation. This document does not change task status or close AISEC-001;
the execution-register owner and independent reviewer decide acceptance.

The accompanying [CSV](mcp-operation-inventory.csv) contains 58 individually
identified rows: **35 application tools (17 read, 18 write)**, eight SDK/control
operations, two app HTTP exports, seven explicitly absent resource/prompt method
markers, and six adjacent OAuth routes. Absent markers and adjacent routes are
not additional registered tools. The CSV records actual shared handlers,
ownership/visibility policy, indirect effects, credential access, source pointers
and limitations per operation. Stable registered names are preserved verbatim.

This review ran only source reads and bounded Python/text cross-checks. It ran no
Bun, tests, app, build, types, lint, install, PostgreSQL, browser or network
campaign. Public/prod configuration and private environment values were not read.
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
A disconnected Gmail account makes a draft handler fail; it does not hide that
tool from discovery. Installing an integration does not dynamically add tools.

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

`mcp/http.ts:16-21` verifies each incoming HTTP request with its abort signal and
a timeout. `mcp/auth.ts:27-40` verifies the access token and hydrates the CRM actor;
`oauth/tokens.ts:70-100` checks signature, issuer, MCP audience, token expiry,
revocation and subject binding. Even a read/discovery request **writes access-token
lastUsedAt** at `:97-100`. That authentication bookkeeping is separate from the
read/write classification of the selected domain tool.

The request context is captured in the handler closure (`mcp/http.ts:24-36`).
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

The CSV is the operation-level matrix. These group notes explain cross-cutting
semantics that a short tool label would hide.

| Surface | Actual shared authority | Effects beyond the obvious record |
| --- | --- | --- |
| Search and CRM reads | tRPC protected context plus feature SQL/canSee. Search independently filters deals, people, organizations and leads (`search/query.ts:48-154`). Lists/details use their feature routers/repos named in the CSV. | Record/count/aggregate/definition/label projections. They are data extraction even though no CSV-export tool exists. Linked projections have the G6 limits below. |
| Pipeline reads and summary | Nonarchived pipeline group membership/admin (`pipelines/pipelineRouter.ts:17-46`); stats owner scope clamps to self without stats.viewOthers (`stats/ownerScope.ts:7-10`) and pipeline/record filtering follows (`stats/router.ts:32-78`). | Summary reads several deal/activity aggregates; it is not a single pipeline row or an unrestricted team-wide report. |
| Deal create/update/move | create needs deal.create/admin, derives owner/group and validates pipeline/references (`deals/dealActions.ts:46-184`; `permissions/entityCreate.ts:24-60`). update rehydrates at its transaction checkpoint; move uses supplied actor with loadEditableDeal (`deals/dealUpdate.ts:84-179`; `dealMove.ts:17-112`). | Labels/catalog links, CAS, audit and PostgreSQL realtime publication. MCP calls these domain services directly; it does not invoke the server action's after-response notification wrapper. |
| Lead create/update/archive/convert | Create and convert require deal.create/admin. Update/archive gate by visibility; owner transfer has a separate permission check (`leads/leadActions.ts:58-171`; `leadUpdate.ts:43-165`; `leadConvert.ts:110-178`). | Conversion creates a deal, archives/stamps the lead, copies notes/activities/guests/participants, links email threads, syncs labels and writes audit/realtime (`convertCarryOver.ts:18-105`; `leadConvert.ts:225-270`). It is not a one-row move. |
| Contact writes | Creation owns the record to the actor and derives visibility; person creation checks its organization reference. Updates use canSee plus can(contact.edit); owner transfer is separately gated (`contacts/personsRepo.ts:54-209`; `orgsRepo.ts:70-185`). | Custom fields, name/email derivation and label links. No provider enrichment or network lookup is invoked by these tool handlers. Creation does not use a separate create flag here. |
| Activity and note writes | Activity refs are gated; updates/completion use canSee plus can(activity.edit/complete), including the assignee exception after visibility. Notes require a visible parent and derive author from actor (`activities/repo.ts:127-267`; `activityUpdate.ts:162-249`; `collaboration/notesRepo.ts:40-76`). | Guest/participant rows and old/new deal activity-date recomputation. Activity creation can enqueue a reminder after commit. That can produce a CRM notification and a preference-gated outbound Gmail notification to the assignee (`activities/reminders.ts:18-64`; `notifications/wire.ts:13-23`; `notifications/emailDispatch.ts:19-25`; `notifications/email/job.ts:59-143`). The downstream worker can use recipient mailbox credentials (`email/sendSystem.ts:34-44`). This is conditional delayed email, not arbitrary-recipient send. No video conference is provisioned merely because videoCallUrl is stored. |
| Email reads | canSeeEmail grants mailbox owner access; private messages have no nonowner-admin bypass; shared mail uses visible linked deal OR person (`email/emailVisibility.ts:20-55`). | get_email returns sanitized stored HTML and attachment/tracking metadata. Attachment bytes/download and provider retrieval are not called (`messageReads.ts:49-115`; `attachmentReads.ts:12-42`). allowRemote=true preserves remote image URLs for possible later host rendering, not a server fetch (`sanitizeHtml.ts:169-195`). |
| Draft reads/writes | Draft SQL is mailbox-owner scoped. Creation derives account ID with getActorMailbox; patch/delete join ownership in their statements (`mcp/tools/writes-email.ts:55-139`; `email/draftRepo.ts:33-164`; `draftEntityReads.ts:11-44`). | Plaintext becomes paragraph HTML; local unsent draft insert/patch/delete only. No Gmail send, scheduling, token refresh, provider draft sync or outbound approval occurs. Existing draft links/thread/privacy survive patching. |

can/canSee are current CRM policies, with inactive-before-admin and record-specific
visibility/ownership behavior (`permissions/can.ts:35-64`, `canSee.ts:5-40`). They
must not be re-described as an already implemented client capability or app-role
intersection. Ownership-transfer authority is also distinct from ordinary edit:
create deal/lead owner overrides and contact/lead ownership edits need their
actual current transfer policy, not a proposed consent write label.

## Current gaps and limits used in CSV rows

| Code | Source-observed boundary or missing check |
| --- | --- |
| G1 | Current OAuth grants are broad. authenticateMcp emits scopes:[] (`mcp/auth.ts:34-40`); OAuth persisted rows have subject/client/token bindings but no granular approved CRM capability/app-role/resource selection (`db/schema/oauth.ts:10-54`). No read-only grant ceiling or installation role is enforced by registering these tools. |
| G2 | Active actor and token validity are rechecked per HTTP request, then role/group/visibility context is a snapshot. No universal per-effect token/native-session recheck exists here. update_deal's fresh actor checkpoint is the bounded exception described in G11, not complete revocation serialization. |
| G3 | Every registered name is advertised independently of actor/grant authority. The readOnlyHint/destructiveHint/idempotentHint/openWorldHint fields neither authorize direct invocation nor filter discovery. |
| G4 | update_lead and archive_lead require visible records but have no general can(deal.edit)/archive gate in these current handlers. update_lead separately checks owner transfer and CAS; archive supports both archive and restore. This inventory records actual enforcement rather than inventing missing grant/role checks (`leads/leadUpdate.ts:78-165`; `leadActions.ts:126-171`). |
| G5 | Draft ownership is strong, but create_email_draft passes link IDs to assertDraftLinks, whose checks are existence-only, not canSee or soft-delete visibility (`email/draftLinks.ts:6-30`). The MCP caller supplies no extra visibility check. Draft lists can filter own drafts by link ID without granting record access. Local draft handlers do not prove a currently usable provider grant or fresh mailbox owner state at every effect. |
| G6 | Parent visibility does not imply an independent visibility check on every linked projection. get_deal gates the deal then returns full nondeleted linked person/org rows (`deal-workspace/summaryRepo.ts:94-129`, `:162-169`); get_lead joins names behind its lead gate (`leads/leadRepo.ts:128-141`); list_deals joins contact names behind deal SQL visibility (`deals/dealRepo.ts:232-269`). These are source-observed projection seams, not executed exploit claims. |
| G7 | convertLead's target pipeline resolver checks existence/archived state and first stage, without using the actor/group visibility restriction (`leads/leadConvert.ts:42-104`). It does not delegate to createDeal's pipeline gate. History carry-over touches child records and email links without per-child mailbox-owner policy in that helper (`convertCarryOver.ts:18-105`). A future policy mapping must not silently treat the entire operation as a simple lead write. |
| G8 | create_person, create_organization, create_activity and add_note have no separate create capability check in the inspected domain paths. Their actual actor ownership, default visibility, reference and parent checks are listed in the CSV. Do not invent current contact/activity/note grant enforcement. Primary visibility group fallback is server-read data, not proof that every fallback independently rechecks membership (`contacts/visibility.ts:17-45`; `permissions/entityCreate.ts:46-60`). |
| G9 | createActivity commits its DB work before scheduleReminder. If enqueue then fails, the tool may error after the activity already exists; no MCP idempotency key or atomic queue/outbox is added here (`activities/repo.ts:157-221`). The reminder is an indirect effect that can proceed through notifyActivityReminder/deliver to an email job and real Gmail send. Recipient activity/parent visibility, email preferences (checked again at send time), connected mailbox and running workers gate delivery (`notifications/wire.ts:84-107`; `notifications/emailDispatch.ts:19-25`; `notifications/email/job.ts:59-143`). Recipient Gmail credential resolution is downstream (`email/sendSystem.ts:34-44`, `:74-78`), although the tool handler reads none. The reminder/email job payloads carry activity/notification IDs, not the originating MCP grant, so this is not newly approved outbound-capability enforcement. A comment about copied activity reminders is not proof that conversion enqueues another job. |
| G10 | SDK call signal +15s is composed at tools/types.ts:90-91 (direct test registry uses 10s). Several read handlers instead call tRPC routers that allocate independent signals; cancellation is not uniformly forwarded end to end. A timer is not proof of hard DB cancellation or CPU preemption. get_email sanitization is not tool-result-injection/capability enforcement. |
| G11 | Committed update_deal rehydrates current actor inside its transaction and consistently uses it for group/edit/reference/audit/event checks. Root observed its bounded native PG16 two-case red/green; the broader 12-file gate is pending. It does not authenticate a raw actor ID, recheck a native cookie/MCP grant, freeze authority changes after the checkpoint or change move_deal_stage. No invited-user policy expansion is claimed. |

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

| Family | Current application/dependency source boundary |
| --- | --- |
| tools/list and tools/call | SDK dispatch is installed by tool registration (`mcp-oHn3ureC.mjs:1584-1606`). The app provides the 35 tool definitions and shared wrapper. Protocol dispatch is not a separate domain permission. |
| initialize / server/discover / initialized | SDK owns handshake and modern discovery (`mcp-oHn3ureC.mjs:870-872`, `:1182-1190`). Legacy initialize and modern server/discover are profile-specific, not a blanket compatibility promise. |
| ping | Inherited protocol control (`src-DdvbAHrR.mjs:6257-6263`); SDK notes its removal from the 2026 modern profile (`mcp-oHn3ureC.mjs:1267`). It is not a CRM tool. |
| cancellation/progress | SDK handles known-request cancellation and progress plumbing (`src-DdvbAHrR.mjs:6257-6263`, `:6348-6350`). App tool callbacks receive the SDK signal. A new server/context per HTTP request does not establish cross-request cancellation. |
| Resources/prompts | No app registerResource/registerPrompt/explicit capability setup exists. McpServer is constructed without such capability options (`mcp/server.ts:15-18`); SDK installs these methods only when their registration/capability setup runs (`mcp-oHn3ureC.mjs:1523-1525`, `:1702-1707`, `:1759-1763`). resources/list/templates/read/subscribe/unsubscribe and prompts/list/get therefore have no application feature/callback here. No app completion, sampling, elicitation or roots-driven operation is registered or invoked. |
| Transport/session | App supplies GET/POST. mcp-handler selects legacy stateless fallback (`node_modules/mcp-handler/dist/index.js:197-207`); SDK legacy transport accepts POST and responds405 to GET/DELETE with no session ID generator (`node_modules/@modelcontextprotocol/server/dist/index.mjs:852-862`). This is source behavior, not a native socket/TLS/client run. |
| OAuth metadata | GET `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` are gated public metadata. The protected-resource JSON is OAuth discovery, not a registered MCP Resource (`oauth/metadata.ts:9-35`). |
| OAuth registration/authorization/token | POST /oauth/register is independently disableable and rate-limited; GET/POST /oauth/authorize validates native session/redirect/CSRF/decision as applicable; POST /oauth/token exchanges codes or refresh tokens. These issue/revoke-use credentials and DB rows rather than exposing tool/domain operations (`app/oauth/register/route.ts:12-48`; `authorize/route.ts:47-118`; `token/route.ts:27-46`). Client self-reported names are not verified upstream identity. |

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

## Independent inventory acceptance

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

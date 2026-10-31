# UX-002: observed integration, consent, automation and app-management flows

Research date: 31 October 2026. Evidence class: authenticated Mobbin capture review.
Five captured web flows, comprising 21 frames, were opened and visually inspected in this
session. The observations below are fresh evidence, rather than completion inferred from the
older integration/workflow notes. No Warpdrive UI or execution-register file was changed.

## Access and method

Direct Mobbin tools were absent from the available tool inventory. Plugin Management search
for `Mobbin` returned no plugin. A selective filesystem lookup found no installed Mobbin search
`SKILL.md`, including the stale catalog entry's package path. No unavailable skill is claimed
as applied.

The documented CUA inventory showed Chrome with an existing authenticated Mobbin capture tab
owned by another workflow task. That tab and all preview tabs were left untouched. A separate
research tab was created in the `Integration UX` browser session. The Mobbin library displayed
an account avatar and allowed access to the complete captured flows without a login prompt.
No account creation, purchase, permission prompt, secret entry or live provider action occurred.

Only Mobbin's own navigation/search and capture-viewer Previous/Next controls were used.
Captured install, consent and uninstall buttons were images, not live provider actions.
The researcher did not click Save/Copy, export assets, download images, save a collection,
post comments or use the AI Assistant. Screens were viewed through transient tool screenshots;
no third-party image, logo, code or screenshot file was added to source or handoff artifacts.

Searches used Mobbin's visible search interface for installation, then its observed web-flow
search route for permission and uninstall queries. New Zendesk links came from actual returned
results. Previously documented Attio/Zapier links were then reopened and their frames inspected
again in this session. A search-result label alone was never counted as a reviewed flow.

## Observed reference register

| Ref | Direct captured flow | Frames inspected | Observations from the images |
| --- | --- | --- | --- |
| U2-01 | [Zendesk: Installing an app](https://mobbin.com/flows/fbc00996-7c3c-4904-94a3-106fda70bf8b) | All 7, advanced one frame at a time | Directory with keyword/category filters and individual app cards; focused app detail with publisher, version, compatibility, price and installation action; target account selection; installation configuration with separate role/group restrictions; progress/success feedback; installed-app area with enabled and disabled sections and a distinct private-app destination. |
| U2-02 | [Zendesk: Uninstalling an app](https://mobbin.com/flows/e2bd8188-c7ed-4115-aa72-cd42abfe722a) | All 3 | Installed app's contextual menu distinguishes its enabled toggle, configuration, developer link and removal; removal opens a separate confirmation; final frame shows success feedback and the app absent from the enabled list. No data-retention or remote-grant outcome was visible in these frames. |
| U2-03 | [Attio: Connecting to Google Calendar](https://mobbin.com/flows/d0abf281-6de9-4d4d-82b3-dacdea792ed5) | All 4 | Benefit-led entry offers Google/Microsoft connection or a manual route. Captured Google consent identifies the requesting app/account and shows individual mail/calendar access choices, a separate ongoing-access choice, details links and cancel/continue actions. The third frame shows selected permissions. The last frame is a return/loading view, not proof of completed sync. |
| U2-04 | [Attio: Creating a workflow](https://mobbin.com/flows/2f4ee290-153e-4f02-b331-676b6a1b64f4) | All 4 | Empty library has a creation action. Editor entry offers assisted examples and a manual starting path. A submitted natural-language request produces a trigger/delay/task graph with a persistent unpublished-state banner and contextual explanation. The explanation explicitly identifies a requested mail-send limitation and the resulting task behavior rather than depicting the task as a sent message. |
| U2-05 | [Zapier: Testing a connection](https://mobbin.com/flows/fcd35efa-2b51-4de9-8999-e1ba024d075c) | All 3 | A chosen account appears within an action inspector's setup/configure/test progression. Its menu separates connection check, reconnect and display-name editing. An inline check-in-progress becomes an account-readiness result, while the broader action remains unconfigured and the workflow unpublished. |

The capture viewer identified these as web images at `1512x945`. That is the reference capture
size, not a responsive or accessibility qualification of Warpdrive. The products' captured
versions differ, and Mobbin's latest-capture label is not evidence of current provider API or
account behavior. No date, permission wording or feature availability in a captured product is
promoted here as an authoritative present-day vendor contract.

## Selected Warpdrive patterns and explicit differences

### Integration discovery and connection readiness

Use the directory-to-focused-detail relationship from U2-01, while preserving Warpdrive's
current shell, 21 stable catalog IDs, category/search behavior, semantic tokens and Radix
adapters. App/provider details should identify who maintains an implementation and distinguish
its version, prerequisites and availability from a real installed account. Keep planned entries
informational; do not add working-looking connection controls before their server contract exists.

U2-05 supports selecting an identifiable account within a workflow action and keeping check,
reconnect and naming operations separate. A check result must state what was checked and when.
Connection health, action permission, resource selection, rule validity and delivery outcome
remain distinct. A successful connection check never labels a workflow action tested, a message
sent, or a provider live-qualified. This maps to CONN lifecycle/diagnostics, provider setup and
EVT/AUTO action binding rather than a second connection or workflow engine.

### Permission review and authority

U2-03 makes the requesting application, account, individual access choices and final decision
visible before consent. U2-01 adds installation-specific account and role/group restriction
context. Adopt explicit owner/account/resource identity and a clear cancel path, with contextual
FA/DE/EN descriptions of read, mutation, outbound and administrative effects.

Warpdrive's choices come from ARCH-001 through ARCH-004 and ARCH-008, not from copying a
provider's broad permissions. Start new client grants minimally; show required/optional
capabilities and selected resources, destination disclosure and the difference between upstream
scopes and CRM authority. Display self-reported versus verified client identity accurately.
A role restriction widget or approved consent screen never replaces server enforcement.

The capture includes a broad selected permission set; that is an observation, not a recommended
default. Likewise, the captured ongoing-access option and expiry text do not establish today's
Google policy or this project's refresh contract. Real scopes/entitlements require the provider
track's current primary-source and actual-account qualification. Personal mailbox content does
not become administrator-readable because an app can be managed centrally.

### Automation setup, simulation and publication

U2-04 supports an obvious empty state, a deterministic manual entry path, selected graph context
and a persistent distinction between edited draft and active published version. U2-05 separates
connection setup from action configuration/testing. Retain Warpdrive's current workflow engine,
localized editor and immutable published versions; align new provider actions to these seams.

Do not imply that assisted generation or a successful local simulation establishes executable
capability, provider consent or external delivery. When an action is unavailable, explain the
actual limitation. A created follow-up task must be labelled as a task, not an email send.
A publish review should summarize execution actor, changed capabilities, connections/resources,
side effects and current validation; publication cannot silently grant new authority.
The precise publication review is Warpdrive's requirement, not a completed screen observed in
this creation capture.

### App installation, disablement and removal

U2-01 and U2-02 support separate discovery, target-account selection, installation configuration,
installed-app management, disablement and removal. Keep package installation, upstream account
connection and a user's grant as distinct identities. Before installation, show version,
publisher evidence, requested permissions and runtime prerequisites. After installation, expose
clear health/configuration/recovery actions under the actual owner/custodian policy.

The reference uninstall confirmation is generic and omits visible retention consequences.
Warpdrive must additionally explain local access blocking, pending/in-flight effects, remote
revocation status, retained imported data and what removal will actually delete. Disable is
reversible suspension; uninstall/removal follows its explicit data/grant policy. Neither action
promises recall of already accepted external effects.

App updates require a permission/version/schema diff and reviewed expansion of authority under
ARCH-009/010. No version-update permission-diff flow was inspected in this session, so this
paragraph records a project requirement, not a researched source-product pattern. Follow-up
research is needed when designing that specific update journey; it does not authorize installing
or publishing an unqualified app runtime.

## Language, accessibility and limits

The inspected captures are English visual references. Natural Farsi-first and German copy,
independent numbering/calendar/timezone choices, mixed-direction IDs/URLs, keyboard order,
focus return, mobile layouts and screen-reader status are Warpdrive acceptance requirements.
They were not validated by browsing these reference images. No English reference text or layout
is assumed to work unchanged in RTL or expanded German copy.

The following are not established by this research:

- Actual provider consent, token storage, refresh/revoke, sync or delivery behavior.
- The source products' server authorization, isolation, security or operational correctness.
- Warpdrive implementation of any proposed install/update/uninstall, permission-review or
  provider workflow, or completion of later UX/QA/SDK/STORE tasks.
- Exhaustive app-management research, particularly version permission changes and data-recovery
  paths absent from the inspected captures.

## Acceptance trace

| UX-002 acceptance area | Fresh evidence and applied pattern |
| --- | --- |
| Integration | U2-01 discovery/detail/account selection; U2-03 provider connection/consent; U2-05 account check and reconnect. |
| Automation | U2-04 manual/assisted creation, graph and draft state; U2-05 setup/configure/test separation. |
| Permission review | U2-03 actual captured access-choice and consent decision screens; U2-01 target account and role/group restrictions. |
| App management | U2-01 installed enabled/disabled app sections and private-app destination; U2-02 contextual disable/configure/remove, confirmation and resulting list. |
| Links and applied patterns without asset copying | Direct Mobbin flow URLs, all inspected frame numbers, concrete observations, adaptation choices and explicit unsupported inferences are recorded above. No assets exported. |

This record supplies the bounded research evidence for all four named UX-002 areas. The
execution-register owner should review it and verify the UX-001 dependency before changing
UX-002 status. This author did not change `tasks.csv`, mark broader journeys implemented,
adopt the unimported scope amendment or create an external approval/resource.

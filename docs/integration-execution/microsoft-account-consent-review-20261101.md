# Microsoft account, tenant and consent review

MS-001's official provider review is complete and accepted following independent review of Microsoft's public documentation on 1 November 2026. [tasks.csv](tasks.csv) is the authority for task status. This record establishes account, permission and policy boundaries; no Microsoft adapter, account, application registration, permission grant or provider runtime was exercised.

The acceptance criterion is: "Verify supported account types, consent modes, current Graph permissions and administrative restrictions." The [15-row matrix](microsoft-account-consent-matrix-20261101.csv) records the reviewed facts, implementation consequences, source URLs and section locators.

## Acceptance and dependencies

| Acceptance criterion                              | Matrix evidence                  |
| ------------------------------------------------- | -------------------------------- |
| Supported account types and tenant boundaries     | A1-A4 and feature-specific P1-P4 |
| Consent modes                                     | C1-C3                            |
| Current Graph permissions                         | P1-P4 and C4                     |
| Administrative restrictions and available options | C2-C5 and F1                     |

MS-001 has MAIL, CAL, CONN and EVT package dependencies with local-foundation scope and no task-specific prerequisite. The reviewed ARCH, CONN, CAL and native MAIL contracts, including the reviewed event and authority contracts, satisfy the relevant foundation dependency for this public provider review. This follows the [programme dependency interpretation](../integration-project-plan.md): reviewed contracts and locally verified foundations support bounded work without waiting for unrelated live-provider, hosting or publication gates.

Shared connection, credential and lifecycle broker implementation, event-effect admission, and actual adapter use of those boundaries remain implementation work. This review gives no broker-usage, runtime or release qualification.

## Account and consent boundaries

Microsoft distinguishes organizational, mixed organizational/personal and personal-only registration audiences. Endpoint routing and registration audience must agree. Directory guest sign-in must bind the intended resource tenant; an accepted login does not establish access to that tenant's resources. See [supported account types](https://learn.microsoft.com/en-us/entra/identity-platform/v2-supported-account-types) and [OIDC authority routing](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc).

Stable account binding must use validated identity claims and tenant/issuer context. Email and UPN can change, and guest identities and privileges differ across tenants. See [Microsoft's ID-token identity guidance](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference).

The nominal delegated admin-consent flags for Mail.ReadWrite, Mail.Send and Calendars.ReadWrite are No. That flag does not establish whether this application can obtain a user's consent in a selected tenant. Microsoft's managed recommended policy excludes Mail.ReadWrite, Calendars.ReadWrite and OnlineMeetings.ReadWrite; alternate policies and named popular-mail-client exceptions exist. See the [Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference) and [managed consent policies](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-app-consent-policies).

Applications requiring assignment disallow user consent and require tenant-wide admin consent even where user consent would otherwise be available. The actual tenant policy, application eligibility and available administrator path remain unknown. See [assignment and admin-consent requirements](https://learn.microsoft.com/en-us/entra/identity-platform/howto-restrict-your-app-to-a-set-of-users).

The matrix also preserves the separate offline_access and .default consent behavior. A feature must select a reviewed scope set and handle renewal separately; this review promises no fixed token lifetime or unconditional consent. See [Microsoft scopes and consent](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc).

## Proposed product boundaries and remaining work

The initial proposed profile uses Global Graph v1.0 with delegated access to the connected owner's mailbox. "Owner mailbox" describes CRM ownership and does not mean exclusively a consumer Microsoft account. Actual availability follows the registration, account, resource and consent matrix. Provider permissions do not confer CRM actor, grant or resource authority; the [identity and authority contract](architecture-identities-authority.md) remains applicable.

Calendar-backed invitations and standalone online meetings are separate feature profiles. Standalone onlineMeeting creation supports delegated work/school accounts and excludes personal accounts. Calendar-backed provider options must come from the selected calendar. See [create onlineMeeting](https://learn.microsoft.com/en-us/graph/api/application-post-onlinemeetings?view=graph-rest-1.0) and [calendar online-meeting providers](https://learn.microsoft.com/en-us/graph/outlook-calendar-online-meetings).

Shared resources, app-only access and national clouds retain separate profiles and qualification. The matrix preserves shared-folder subscription limits, application access policy and additive Exchange/Entra grant considerations. No fallback to broader permissions is authorized by this review.

MS-002 through MS-016 remain planned. Their implementation, local failure matrices, resource selection, actual tenant/application/mailbox/license evidence, authorized live checks and operational guidance remain required. Existing CRM authorization and outbound approval also apply to provider effects.

## Review provenance

The accepted programme packet is `ms001-account-consent-review-20261101`, with SHA256SUMS digest `73726d49cc916f38b520cb3380dee6952f07543d76e1916b05cf05cbcef2e183`. Independent review found all four acceptance clauses covered and no remaining provider-source review gap. The matrix in this record preserves its 15 rows and source URLs exactly.

The review reuses the MAIL owner's public Graph research associated with immutable MAIL source `46f7b1bb76e4bea2a082112eb11dfa801f4ffdd4`. Its Graph note is 8,843 bytes, SHA256 `6aeaae020f6661affff6e9bba2f23006212c50c1d696aa0d45364997b894d2cf`; its public report is 1,059 bytes, SHA256 `f8ec2d55f16cd8674d0224a71fe54a1b9059e50c17aa43c3a62ceca11f5034d3`. The full sealed note is retained in programme evidence and is not duplicated here. That research supplies no adapter or provider qualification.

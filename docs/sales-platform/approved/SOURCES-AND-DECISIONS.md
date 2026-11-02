# Sources, baseline, and decisions

Prepared 31 October 2026. The files below were inspected read-only. They are source and planning evidence, not a new runtime qualification campaign. Active branches may have advanced after the recorded observation.

## Baseline observations

| Evidence | Observation and limitation |
| --- | --- |
| Preview serving port 3116 | Process working directory `/private/tmp/warpdrive-workflows-20261031`; Git head `d0c83e8ad0ed07097f40bec82727976d022b7742`; branch `codex/visual-workflows`; clean at inspection. |
| Pipeline picker | Two visible entries: Sales Pipeline and Workflow preview. This is a session-visible count, not an exhaustive database/archived-pipeline inventory. |
| `src/db/schema/pipelines.ts` | One optional `visibilityGroupId`; no workspace foreign key or per-user pipeline membership table in this model. |
| `src/features/pipelines/pipelineActions.ts` and `schemas.ts` | Management capability required; creation and stage creation have no explicit count quota. No large-scale capacity test was run for this research. |
| `src/db/schema/identity.ts` and identity schemas | Many-to-many teams and visibility groups; one assigned permission-set reference on each user. |
| `pipelineRouter.ts`, `permissions/canSee.ts`, and `permissions/sql.ts` | Pipeline visibility is a gate; record visibility further restricts access; an active administrator bypass exists. Do not broaden authority through a view, new role, workflow, or workspace plugin. |
| `src/db/schema/deals.ts` | One pipeline and stage per deal; source-channel fields are attribution metadata, not collaboration-channel membership. |
| `CreatePipelineDialog.tsx` | Current creation UI submits the pipeline name and does not expose a complete sharing workflow. |
| Integrations checkout | `/Users/ali/Developer/warpdrive-integrations`, observed head `8539fe8c4aeb0b58b6d05e629710460ef90bbed4`; in-progress source is distinct from the preview branch. No attempt was made to merge it. |
| Migration divergence | Workflow branch: `drizzle/0083_visual_workflows.sql`; integrations checkout: a different `0083_natural_deathstrike.sql` and follow-on `0084`–`0088` plus branch-specific snapshots/journal. Inspect actual applied ledgers before selecting a reconciliation strategy. |

## Existing work to extend

Paths are relative to the checkout named in the table; consult its current head before implementation. Existing status documents contain reported verification; this planning task did not rerun those suites.

| Existing document/source | Reuse in this programme |
| --- | --- |
| Preview: `docs/pipeline-analytics-proposal.md` | Reuse Insights layout, metric definitions, forecast/movement backlog, and staged analytics delivery. SP-08 is a dependency/cross-reference, not a replacement proposal. |
| Preview: `src/features/stats/stageConversion.ts` | Existing created-cohort calculation uses furthest-stage inference and historic change logs. New event-exact reporting must be named and versioned separately. |
| Preview: `docs/workflows/implementation-plan.md`, `status.md`, `ux-design-reference.md`, `ui-review.md` | Reuse WF task ownership, current manual builder, approved event/effect direction, actual design tokens, and published-version behavior. The broader release gates remain open in the observed status. |
| Preview: `docs/auth-implementation-plan.md` and `docs/auth-ui-design.md` | Preserve single-tenant scope, Better Auth, invitation-only admission, existing authority, and the current security/admin UI. |
| Preview: saved-filter and custom-field schemas/services | Extend existing identifiers, ownership and type handling; migrate old filter definitions through versioned adapters. |
| Integrations: `docs/local-integrations-plan.md` and `docs/local-integrations-progress.md` | Consume IG mailbox/provider/connection/notification capabilities only at their actual qualified status. P2 remains a separate decision. |
| Integrations: `docs/data-conventions.md` | Preserve raw phone input, explicit country, civil dates versus instants, source-calendar imports, exact IRR/toman display, and independence from UI locale. |
| Existing calendar documentation referenced by IG-22 | Avoid creating a parallel calendar editor or making unverified Iranian-calendar recurrence promises. Calendar parity and conferencing retain their separate scope. |

## Primary external sources

These support concepts and published capabilities, not proof of the entire current UI or commercial entitlement. No source is used to claim complete competitor parity.

| Source | What is used |
| --- | --- |
| [Pipedrive: multiple pipelines](https://support.pipedrive.com/en/article/how-can-i-have-multiple-pipelines) | Separate pipelines for different processes; use fields/filters for segmentation. |
| [Salesforce: AIDA funnel](https://www.salesforce.com/ca/blog/help-customer-through-sales-funnel/?bc=OTH) | Awareness, interest, desire, action as a marketing/conversion model. |
| [Salesforce: account-based marketing](https://www.salesforce.com/marketing/account-based-marketing-guide/?bc=OTH) | Target-account coordination and personalized engagement. |
| [ProductLed: defining PQLs](https://productled.com/blog/how-to-define-pqls) | Product-qualified signals based on customer fit, use/value, and intent. |
| [Winning by Design: Bowtie customer success](https://winningbydesign.com/resources/blueprints/customer-success-operating-model/) | Post-sale onboarding, adoption and expansion alongside acquisition. |
| [HubSpot: Flywheel](https://www.hubspot.com/flywheel) | Attract, engage and delight as a customer-centered growth model. |
| [Salesforce: deal registration](https://help.salesforce.com/s/articleView?id=sf.networks_deal_reg_intro.htm&language=en_US&type=5) | Partner submission, review, permissions and channel-conflict workflows. |
| [Loopio: RFP response checklist](https://loopio.com/blog/rfp-process-checklist/) | Qualification, planning, drafting, review and response as a tender workflow. |
| [MEDDICC: MEDDPICC](https://meddicc.com/meddpicc-sales-methodology-and-process) | Structured evidence for complex opportunity qualification. |
| [Winning by Design: SPICED](https://winningbydesign.com/spiced-framework/) | Situation, pain, impact, critical event and decision. |
| [Huthwaite: SPIN](https://www.huthwaiteinternational.com/spin-methodology) | Situation/problem/implication/need-payoff questioning. |
| [Challenger: methodology](https://challengerinc.com/what-is-challenger-sales-methodology/?es_p=4059497) | Teach, tailor, take control and constructive tension. |
| [Sandler: selling system](https://sandler.com/sandler-selling-system/) | Consultative selling and qualification guidance. |
| [Salesforce: BANT qualification](https://help.salesforce.com/s/articleView?id=sales.sales_agents_preparing_your_agent_to_use_qualification.htm&language=en_US&type=5) | Budget, authority, need and timeline fields. |
| [Better Auth: Organization plugin](https://better-auth.com/docs/plugins/organization) | Optional organization/member/team capabilities. It does not establish isolation for Warpdrive data, files, jobs or integrations. Adoption requires an authority/migration design decision. |

Exact Mobbin references, observation limits and planned studies are in [UX-RESEARCH.md](UX-RESEARCH.md). A screenshot can establish an interaction shown in the capture; it cannot establish security, scalability, accessibility, provider support or account entitlement.

## Decisions and proposed defaults

All defaults below are proposals for this programme. They preserve previously documented constraints where relevant; they are not newly recorded user approvals.

| ID | Decision | Proposed default | Decision point |
| --- | --- | --- | --- |
| D-01 | First release scope | Improve the current single workspace before introducing multi-tenancy. | R0 product review. |
| D-02 | Pipeline versus saved view | New process means new pipeline; a segment or owner difference means a view/filter unless evidence says otherwise. | UX-01 and SP-02.1. |
| D-03 | Access semantics | Existing capabilities and record rules form the ceiling; new pipeline scopes cannot bypass them. Keep the current explicit admin model until a reviewed change. | SP-02.2 security review. |
| D-04 | Pipeline sharing representation | Select a typed scope policy only after comparing the legacy group model with actual jobs. No hidden broadening through additive union rules. | SP-02.2. |
| D-05 | Template behavior | Immutable versions; preview before install; manual edits stay local; upgrades show a diff and require explicit application. | SP-04.1–04.4. |
| D-06 | Stage enforcement | Advisory first; blocking rules only after per-pipeline activation, with server enforcement and auditable overrides. Existing deals are not mass-moved. | SP-04.5–04.6. |
| D-07 | Historic analytics | Keep the existing inferred funnel labeled; add event-exact measures only for qualified history; never manufacture missing events. | SP-08.1–08.4. |
| D-08 | Forecast | Explainable scenarios and explicit probability sources first; no predictive AI score marketed as fact. | SP-08.6. |
| D-09 | Customer lifecycle | Keep acquisition outcome immutable in meaning; link post-sale/renewal records rather than repurpose won/lost. | SP-09.1. |
| D-10 | External partners | Internal partner management first. Portal writes and invites wait for qualified workspace and resource isolation. | SP-10.7 and SP-14.8. |
| D-11 | Framework content | Author contextual guidance; verify redistribution/attribution; do not bundle copied proprietary courses. | SP-05.1. |
| D-12 | Workspace architecture | Compare separate deployments/databases with shared-database tenancy; choose from evidence. Better Auth Organization is optional, never an automatic install. | SP-14.1–14.2. |
| D-13 | Workspace limits | No artificial commercial quota by default for the open-source edition; expose measured operator limits and abuse/concurrency protection. | SP-14.8 and SP-15.4. |
| D-14 | Regional behavior | Farsi first, German next, English retained; currency/calendar/country/timezone remain independent. | Every project design and release gate. |
| D-15 | Provider effects | Reuse approved IG/WF contracts. Simulation is read-only; an uncertain external write is reviewed before any retry. | SP-07 and each provider gate. |
| D-16 | Release timing | Relative releases and effort ranges only until owners/capacity and dependencies are confirmed. | Programme review cadence. |

## Evidence status vocabulary

- **Observed:** inspected source or visible UI; scope is named.
- **Reported in an existing ledger:** another project records evidence; this task did not rerun it.
- **Proposed:** architecture, UX, target, or task requiring design/implementation.
- **Qualified locally:** future evidence from the named exact build and controlled environment.
- **Provider-qualified:** future authorized provider/version/capability evidence.
- **Pilot accepted / production operated:** future real-use evidence, explicitly separate from local qualification.

All 128 task-register entries begin as **Planned**. Earlier completed work is a dependency or reused foundation, not reclassified as newly completed tasks.

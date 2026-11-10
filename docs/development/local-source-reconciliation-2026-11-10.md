# Local source reconciliation, 10 November 2026

This increment finishes the remaining audited local source before newsletter work begins. It combines Workflow Studio, native privacy review, Calendar ownership/providers/reminders, private project creation and workspace actions, gated navigation, and daily dependency maintenance with the current Main implementation.

The canonical schema adds contiguous migrations 0110, 0111 and 0112. Historical SQL stays unchanged. Fresh and populated upgrades are covered separately from provider and installation acceptance.

## Source disposition

| Local source                              | Disposition in the current implementation                                                                                                                                                                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow and dashboard                    | Current Studio and execution work reconciled with Main. Migration business-data assertions and the invalid branch fixture repaired against real PostgreSQL. Superseded V1 AI, mail and event prototypes retained as inert source under `preserved/2026-11-10/workflow-v1/`. |
| Privacy                                   | Native original-intake reviewer reader and review UI completed, with bounded internal discovery observation and cancellation precedence. Existing lifecycle and provider acceptance limits remain explicit.                                                                 |
| Calendar                                  | Ownership, sharing, personal reminder policies, provider catalog/session guards, edit persistence and canonical migration admission completed. Existing native reminder generations and the separate Calendar intent queue retain their respective ownership.               |
| Agency projects                           | Native create/list/read/start/replay paths and actual UI completed with current staff/module/permission admission, private membership, exact-session guards and receipt reconciliation. The module and project-create permission remain disabled by default.                |
| Integrations, Mail, billing and CI copies | Audited source was already adopted in Main or equivalent to newer implementation. Older unique security variants are retained as inert `.source` files.                                                                                                                     |
| Goals and sidebar                         | Newer compact KPI implementation retained. Older unique Goals variants preserved as inert source. The remaining meaningful pipeline navigation regression was ported.                                                                                                       |
| Settings                                  | Daily grouped dependency maintenance completed for the four existing Bun roots and GitHub Actions.                                                                                                                                                                          |

The original 951 changed source paths across 12 checkouts are also committed as exact historical input checkpoints. The [input ledger](local-source-inputs-2026-11-10.json) records each original parent, archive commit, complete tree, audited blob, mode and SHA-256. Independent review verified all 951 entries and all unrelated parent paths. Seven private output artifacts and one generated dependency directory are excluded.

The archive checkpoints are joined using an explicit preservation merge with the already reconciled current tree. This records the original inputs without activating obsolete implementations or replacing the reviewed ports. It is separate from the normal implementation merges that produced the current source. The same ancestry reconciliation records older already-adopted Calendar, settings, analytics and project fixture heads, including original commits whose content had previously been squash merged or cherry picked. The analytics synchronization commit retains its genuine mailbox-recovery issue mapping.

## Verification and scope

Independent source review covered Workflow runtime changes, native privacy boundaries, Calendar permissions/session/reminder behavior, private project authority and canonical DDL. Review findings were repaired and their regressions were exercised against real PostgreSQL where applicable. The aggregate privacy inventory is reconciled to the combined source; unsupported new stores remain explicitly classified rather than being declared lifecycle adapters.

The combined revision must pass full unit and PostgreSQL suites, application/worker/site/documentation builds, and actual production-browser journeys before merging. Required PR checks and managed CodeQL still apply. After merging, the resulting exact Main revision requires its own checks, traceability and CodeQL evidence. Run URLs and immutable revisions belong in the integration PR and the local completion report.

This is source completion and integration of the audited local increment. It does not complete broad programmes, qualify real calendar or mail providers, establish installed behavior or human journey acceptance, publish a release, deploy production, or implement the forthcoming newsletter module. Existing release policies and the excluded deal-workspace scope are retained.

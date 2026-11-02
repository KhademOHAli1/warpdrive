# Main admission, 1 November 2026

This record admits the reviewed source basis at [main 43a5fb4d2a6be7bbbd260855a6a8e1ce55fbf3c1](https://github.com/KhademOHAli1/warpdrive/commit/43a5fb4d2a6be7bbbd260855a6a8e1ce55fbf3c1), tree 4b477872f1e9010383343060dc15949169dcf89e, for the two review criteria below. The register change is limited to EVT-001 and MS-001: **42 completed / 404 planned / 446 total**, across the existing 23 packages. The [execution register](tasks.csv) remains the single status source. No criterion, dependency, stage, task ID or wider planning scope changes. This is a dated admission cut, not a reservation of the future main head. Rebase the documentation proposal against then-current main before application and compare any affected evidence bindings.

## Exact review admission

| Task    | Unchanged acceptance                                                                                      | Evidence class and admitted result                                                                                                                                                                                                             |
| ------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EVT-001 | Adopt existing domain hooks and workflow ownership instead of creating a parallel rule engine or queue.   | Source review. [The reconciliation record](workflow-event-reconciliation-20261101.md) identifies the adopted domain, Workflow and pg-boss owners and the extension contract.                                                                   |
| MS-001  | Verify supported account types, consent modes, current Graph permissions and administrative restrictions. | Official provider review. [The account and consent review](microsoft-account-consent-review-20261101.md) and [matrix](microsoft-account-consent-matrix-20261101.csv) cover the four clauses and retain implementation and live-provider gates. |

The EVT author review and independent acceptance review first bound ten source files and five contract/tracker/adoption documents to b64a9fb4c4920aea8f4c0e56e6a2568d2f106560. All 15 blob identities remain exact at fd49d8fa4ec3f344b3343b0484696e65bc5545e0 and this admitted main cut. The [fd49-to-43a5 comparison](https://github.com/KhademOHAli1/warpdrive/compare/fd49d8fa4ec3f344b3343b0484696e65bc5545e0...43a5fb4d2a6be7bbbd260855a6a8e1ce55fbf3c1) changes only four test fixture files. Production source, schema, migrations, dependency files and the reviewed contracts are unchanged across that repair.

MS-001 admits the reviewed public-provider findings dated 1 November 2026. It does not claim an exercised Microsoft registration, tenant, grant, mailbox, calendar, meeting or adapter. Neither review is expanded by the green CI result.

## Local-foundation meaning

The [accepted plan dependency definition](https://github.com/KhademOHAli1/warpdrive/blob/43a5fb4d2a6be7bbbd260855a6a8e1ce55fbf3c1/docs/integration-project-plan.md#L119-L124) means reviewed contracts and locally verified foundations relevant to the selected work. It does not require every live-provider, hosting or publication task in a prerequisite package to finish first.

EVT-001 retains CONN as its local-foundation dependency. This source review uses the accepted [identity and authority](architecture-identities-authority.md) and [event and delivery](architecture-events-delivery.md) boundaries and the adopted domain/Workflow/queue source. It does not certify the future credential/grant broker or the entire CONN package.

MS-001 retains MAIL;CAL;CONN;EVT and local-foundation scope, with no task-specific prerequisite added. Those reviewed contracts and source ownership boundaries are sufficient for the bounded public-provider review. MAIL transport, calendar semantics, connection lifecycle and event-effect authority remain applicable implementation foundations for later MS tasks. Closing this review does not waive them or close those packages.

The 586-task planning amendment remains unimported. The admitted execution denominator is 446. This admission adds no rows, priority override, provider entitlement or release claim.

## Hosted CI cuts remain separate

[Public Bun CI run 41320388147](https://github.com/KhademOHAli1/warpdrive/actions/runs/41320388147) completed **SUCCESS** at exact main 43a5fb4d2a6be7bbbd260855a6a8e1ce55fbf3c1. Its terminal status was independently verified. The owner reports 8,309 unit tests passed with 3 skipped, 2,940 PostgreSQL integration tests passed across 631 files, standalone types and lint, the application build and five worker bundles, and site/docs checks passed. These are the selected CI commands and their observed scope, not provider or deployment acceptance.

The three skipped unit cases are in scripts/mail-migration-plan.test.ts. They receive no execution credit. Counts from earlier or focused runs are not added to this run's totals.

| Exact cut                                | Hosted run and outcome                                                                     | Preserved limit                                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| b64a9fb4c4920aea8f4c0e56e6a2568d2f106560 | [41312518103](https://github.com/KhademOHAli1/warpdrive/actions/runs/41312518103), FAILURE | 7,224 unit tests passed in 1,084 files, but one unhandled window-is-not-defined exception failed the step. PostgreSQL and application/server builds were skipped. |
| fd49d8fa4ec3f344b3343b0484696e65bc5545e0 | [41318148109](https://github.com/KhademOHAli1/warpdrive/actions/runs/41318148109), FAILURE | Unit: 8,309 passed and 3 skipped. PostgreSQL: 2,938 passed and 1 failed across 629 passed files and 1 failed file. Application/server builds were skipped.        |
| 43a5fb4d2a6be7bbbd260855a6a8e1ce55fbf3c1 | [41320388147](https://github.com/KhademOHAli1/warpdrive/actions/runs/41320388147), SUCCESS | The repaired fixture model and new mailbox-policy regression are in this cut. The three skipped unit cases remain explicit.                                       |

The fd49 PostgreSQL failure came from a fixture expecting a second personal mailbox insert to violate the former per-user uniqueness rule. MAIL migration 0088 had deliberately removed that rule and restricted default-mailbox uniqueness to default accounts. The main repair updates the fixture model and its regression coverage. The green successor does not rewrite either earlier failed receipt.

## Source and operational boundary

The admitted 43a5 cut preserves the canonical migration prefix 0 through 85, Workflow 86, CONN 87 and MAIL 88 through 97. This source fact does not accept an arbitrary installed ledger or divergent historical CONN/Workflow numbering. Use current main migration policy and its own receipts for any future authorized upgrade.

Historical programme receipts retain their original source, environment and evidence class under the [evidence taxonomy](evidence-taxonomy.md). Old local-profile commands, detached worktrees, runtime grants and stopped preview receipts are historical context, not instructions to replay them. Later main changes follow the current owner's sequential publication boundary; this record establishes no continuing cleanup-specific hold.

This documentation records the two review admissions only. It implements no durable CRM outbox, automatic event admission, provider adapter, connection lifecycle service, deployed runtime or live-provider installation. Later EVT/MS tasks retain their unchanged acceptance and verification.

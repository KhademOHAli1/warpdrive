# Warpdrive delivery system

The [central GitHub Project](https://github.com/users/KhademOHAli1/projects/3) and canonical GitHub issues own live execution. [ROADMAP.md](../../ROADMAP.md) is the entry point. Specifications remain the source for product and technical decisions. Historical CSV/JSON registers and imported snapshots retain their original evidence; they no longer form a second manual execution ledger.

## Ownership and scope

@KhademOHAli1 is the accountable GitHub owner. Each canonical issue records its responsible module, original task IDs, specification links, full acceptance scope, observed historical status and dependencies. Module owners work in their scoped branches and use reviewed pull requests, with canonical issue traceability for every included commit. Validate the exact increment with task-owned resources. Integrate only when authorized and verify the resulting exact-main CI and CodeQL separately. Follow [CI release controls](ci-release-controls.md) and [AGENTS.md](../../AGENTS.md) for current rules.

The one-time consolidation from `68e9e55890dd1ceedfbfe0853019673bf79105e4` completed in [PR #952](https://github.com/KhademOHAli1/warpdrive/pull/952) at `86201a96522f22607df3710d809a1391f562b940`. The frozen base and integration branch are historical.

Source snapshots are historical observations, not certification. Imported work starts open unless current GitHub acceptance proves its full scope. Passing a subset, synthetic provider protocol checks, generated packets and failed-first diagnostics do not close a broad item. Overlapping plans have different denominators; do not publish a combined completion percentage.

## Stages and evidence

| Stage                            | Required meaning                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Planned / In progress / Blocked  | Work remains; a blocker names an actual dependency and owner.                                        |
| Source verified                  | Bounded implementation and relevant checks are evidenced at a stated revision.                       |
| Integrated                       | Source is in main and required CI passed at that exact revision.                                     |
| Accepted                         | The complete canonical acceptance scope and relevant user journey have been exercised with evidence. |
| Released                         | An explicit release action published a version containing the accepted revision.                     |
| Deployed                         | A separately authorized installation actually received that release.                                 |
| Provider / installation accepted | The real provider or installed environment passed its declared acceptance checks.                    |

Issue state and Project fields are views of evidence, never substitutes for it. Release tooling validates the exact revision, issue scope and acceptance record. A release does not authorize deployment or claim all expanded roadmaps are complete. Consolidating source does not accept or release every feature contained in that source.

The existing MAIL policy assigns the next unreserved `1.5.x` patch in completion order, starting at `1.5.1`, to each release-ready mail deliverable; MAIL task numbers do not choose patch numbers. `1.6.0` remains reserved for the entire unchanged `programme/mail` scope. The core release policy, technical acceptance allowlist, human-only scopes and provider/installation gates remain unchanged. See [release operations](release-operations.md) for committed plans, exact-main CI, acceptance and explicit publication.

## Operating the roadmap

1. Search the Project and source-to-issue mapping before creating work. Use the bug, feature or maintenance intake forms; report security vulnerabilities privately.
2. Keep one canonical issue per bounded implementation, linking every applicable source ID. Preserve source acceptance, dependencies and evidence when splitting scope.
3. Set the actual assignee, module label, priority and release milestone. Add native blocking relationships for genuine dependencies. Use a comment for current progress and link precise checks.
4. Include the canonical issue in every delivery commit or delivery manifest. Use isolated resources under the repository rules. Record branch qualification separately from exact-main integration evidence.
5. Record whole-scope acceptance with the documented release tooling format. Select a usable journey milestone and a full revision for the next release only when its actual scope and gates are ready.

The importer preserves live state, operator notes and existing labels. Its mapping and exports are generated snapshots. Reconcile and rerun the importer for specification changes; do not manually edit generated mapping files or reset issues from old ledgers. See the release operator guide in this directory for exact commands after tooling integration.

## Public evidence

This repository is public. Public issues and artifacts may contain synthetic fixtures, source links, CI run links and sanitized acceptance summaries. Keep customer records, mailbox contents, credentials, private installed logs and exploit details in their appropriate private systems. A public issue may link a safe evidence identifier without copying sensitive contents.

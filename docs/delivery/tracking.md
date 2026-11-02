# Roadmap import and live tracking

The [central Warpdrive Project](https://github.com/users/KhademOHAli1/projects/3) owns live execution together with canonical repository issues. The Project is public and user-owned, matching the public repository roadmap. Do not put credentials, personal data, private customer/provider evidence or sensitive security details in public issues.

The root [roadmap index](../../ROADMAP.md) links programmes, views and the preserved source register. The [release guide](README.md) describes shipping an accepted revision.

## What is authoritative

- `roadmap.json` preserves approved scope, original task IDs, acceptance clauses, dependency bindings, ownership responsibilities and dated source observations. Each `source_tasks` entry retains its original record and source pointer. Multiple source references can map to one canonical implementation.
- GitHub issue assignees, milestones, labels, comments, relationships and Project fields own current execution. `KhademOHAli1` is the coordinating GitHub assignee; each issue also states the module implementation responsibility.
- Original CSV/JSON status ledgers are historical import records. Do not update them as competing live trackers. Product and technical specification changes still belong in committed documentation and require source reconciliation.
- `issue-map.json` is the generated original-task-to-canonical-issue map. `execution-snapshot.json` is an optional generated observation of GitHub, not a second authority.
- Source implemented, integrated with required green CI, user journey accepted, released, deployed and real provider/installation accepted are separate claims. Historical completed rows, a passing subset, synthetic tests, failed-first diagnostics and generated evidence packets do not close broad tasks.

Source counts overlap. Report counts by namespace and unresolved source conditions; do not combine them into a completion percentage. Source-match failures, reference uncertainties, deferred scope, external prerequisites and acceptance limitations remain preserved.

## Validate and plan

The tooling uses Python 3 standard library and the existing authenticated `gh` CLI. It does not install packages, change credentials, alter lockfiles, create branches or publish repository commits. Run from the repository root:

```sh
python3 scripts/delivery/tracking.py validate
python3 -m unittest discover -s scripts/delivery -p '*test*.py' -v
python3 scripts/delivery/tracking.py import --dry-run --phase records
```

Validation rejects duplicate canonical identities, duplicate original task mappings, incomplete declared source counts, unknown dependencies, cycles and oversized immediate parent groups. Hierarchy depth is checked independently of item order, with at most eight parent hops; both native blocking directions are limited to 50 distinct edges. Canonical IDs support namespaced forms such as `integration/ARCH-005`.

The dry-run reads all existing issues, labels and milestones before planning additions. It performs no external mutations and writes no mapping/checkpoint. Reconcile any duplicate identity or an unmanaged issue whose title already contains the canonical ID before continuing; never create a second issue to bypass the conflict.

## Import and resume

```sh
python3 scripts/delivery/tracking.py import --apply --phase records --max-create 100 --max-writes 100 --pause 1.1
```

Repeat the command until all records are mapped. `--max-create` bounds only newly created issue records; `--max-writes` bounds every external write request, including metadata, issue, relationship and optional Project changes. Budget exhaustion checkpoints a clean partial result with `stopped_reason: write-budget`; metadata can consume part of the allowance before issue creation. This local bound does not override GitHub quotas. GitHub can impose secondary content-creation limits, including hourly limits. On a rate-limit or ambiguous response, retain the checkpoint and resume after the stated limit permits; the importer never blindly retries a content creation.

Before each issue POST, a pending creation intent is saved in the checkpoint. A real command timeout, interruption or crash leaves that intent intact if the outcome is unknown. A later run must find the unique canonical marker before adopting the successful request; an unresolved intent blocks all further external mutations. Wait for the issue list to catch up, or have the operator independently establish what happened and explicitly reconcile the checkpoint. Never remove an unresolved intent merely to retry the POST.

Every run reconciles the actual remote issues independently of its checkpoint. Each issue contains a stable `warpdrive:delivery-id` marker. A lost create response is recovered by rereading GitHub; duplicate markers fail closed. GitHub's paginated issue list can briefly lag accepted writes. A checkpoint-known issue missing from that list is recovered only by directly reading its saved issue number and matching the exact canonical marker, database ID and node ID. A missing issue or mismatched identity stops before any recreation; retain the checkpoint and reconcile manually. Final verification uses the same independent direct-read fallback. A nonblocking writer lock prevents two local processes sharing the same checkpoint from creating concurrently. Use one importer for the repository, including across hosts.

Defaults are `docs/delivery/import-state.json` for checkpoints and `docs/delivery/issue-map.json` for the generated mapping. Both can be redirected with `--checkpoint` and `--mapping`. A checkpoint saves after every accepted resource. It is not proof of current GitHub state.

Existing issue state, assignees, milestones, labels, comments and operator history are preserved. The initial milestone and `release:next` label apply to the four selected journey issues. The importer never closes issues from historical status. Additive labels and missing milestone definitions are reconciled without replacing existing definitions.

To refresh changed approved scope, review the dry-run and use `--refresh-spec`. Only the importer-managed specification region can be replaced; operator updates below `Live delivery record` remain. If the managed region itself was edited or its previous hash is unavailable, preserve the issue and resolve the reported conflict explicitly. Do not erase comments or acceptance history to make an import pass.

## Reconcile actual dependencies

After record import:

```sh
python3 scripts/delivery/tracking.py import --dry-run --phase relationships
python3 scripts/delivery/tracking.py import --apply --phase relationships --max-writes 100 --pause 1.1
```

This creates native GitHub parent/sub-issue and blocking relationships. It independently rereads and checkpoints each accepted edge before the next write. On later runs, a missing previously verified edge is treated as a conflict, preserving operator deletion evidence. Review the intent before selecting `--repair-relationships` to restore the approved missing edges explicitly. The importer never removes existing relationships or reparents an issue automatically. A conflicting parent must be reviewed rather than silently overwritten. Programme/package hierarchy keeps immediate groups within GitHub's 100-child limit.

If record import is still partial, unresolved relationship targets are deferred. A complete source-to-issue mapping alone is not proof that the relationships or Project population are complete. Check the phase counts and independent verification results.

## Project population

The five existing views are [Full roadmap](https://github.com/users/KhademOHAli1/projects/3/views/1), [Next release](https://github.com/users/KhademOHAli1/projects/3/views/2), [Blocked work](https://github.com/users/KhademOHAli1/projects/3/views/3), [Maintenance](https://github.com/users/KhademOHAli1/projects/3/views/4) and [By module](https://github.com/users/KhademOHAli1/projects/3/views/5).

Module uses `module:*` labels, next-release selection uses `release:next`, and maintenance uses `module:operations`. Blocked work uses `is:blocked` to show actual native dependency blockers. Use `status:Blocked` to find recorded external or operational blockers when needed. Status options are Todo, In Progress, Blocked, Source verified, Integrated, Accepted and Released. Priority is P0 through P3, with P2 as the default for new work and P1 for the first release scope. Ownership uses issue assignees and Release uses the issue milestone. Historical active/in-progress observations receive `import:active`; explicit source-verified observations receive `import:source-verified`; explicit blocked/waiting-external observations receive `import:blocked`, allowing initial native status population without inferring acceptance from completed rows. These import labels are observations, not a second live status authority.

The authorized GitHub UI can add issues to the Project. Optional API population requires existing account Project read/write access; issue import does not depend on that scope. If access is missing, use the authorized UI or request the exact account `project` scope through the normal user authorization flow. Never expose a token or change credentials silently.

For API population, provide a reviewed JSON configuration with the actual Project node ID and field/option IDs:

```json
{
  "id": "ACTUAL_PROJECT_NODE_ID",
  "fields": {
    "Status": { "id": "ACTUAL_STATUS_FIELD_ID", "options": { "Todo": "ACTUAL_TODO_OPTION_ID" } },
    "Priority": {
      "id": "ACTUAL_PRIORITY_FIELD_ID",
      "options": {
        "P0": "ACTUAL_P0_OPTION_ID",
        "P1": "ACTUAL_P1_OPTION_ID",
        "P2": "ACTUAL_P2_OPTION_ID",
        "P3": "ACTUAL_P3_OPTION_ID"
      }
    }
  }
}
```

```sh
python3 scripts/delivery/tracking.py import --dry-run --phase project --project-config work/project-config.json
python3 scripts/delivery/tracking.py import --apply --phase project --project-config work/project-config.json
```

The Project phase rereads membership and configured fields independently. It initializes only blank Status/Priority fields, including after an interruption, and preserves existing nonblank live choices. Initial status uses explicit active/in-progress, source-verified or blocked/waiting-external observations; other rows default to Todo. Include those actual option IDs in the configuration when importing such rows. Missing membership or missing persisted fields is an error, not a successful completion claim.

## Refresh reports and index

```sh
python3 scripts/delivery/tracking.py snapshot
python3 scripts/delivery/render_index.py
python3 scripts/delivery/render_index.py --check
```

Snapshot generation reconciles checkpoint and existing mapping identities against live GitHub, including direct reads when the list lags. It requires the full canonical roadmap by default and preserves an existing output if coverage is incomplete. During import, `snapshot --allow-partial` explicitly records missing canonical IDs and retains every original source reference, including unmapped rows, rather than silently dropping unfinished work.

The index generator uses verified mapping URLs and rejects a missing mapping by default. During an explicitly partial import, `--allow-partial` displays pending records without inventing issue URLs. It lists every programme and source namespace; it never calculates an aggregate completion percentage. The integration coordinator reviews and publishes generated documentation with the owned tooling increment. Preserve all concurrent product edits and the existing main-publication and heavy-job queue boundaries.


## Adopt a new bug or maintenance intake

Use the issue forms to create an ordinary issue, then triage its bounded scope. Add a registered item to `roadmap.json` with a stable ID such as `bug/reminder-recovery`, its complete acceptance criteria, module, owner and actual dependencies. This records scope decisions, while GitHub retains live execution. Do not create another issue for the same intake.

Ensure the module/kind labels exist (a bounded records import with `--max-create 0` can prepare metadata), then adopt the exact original issue:

```sh
python3 scripts/delivery/tracking.py adopt --canonical-id bug/reminder-recovery --issue 123 --dry-run
python3 scripts/delivery/tracking.py adopt --canonical-id bug/reminder-recovery --issue 123 --apply
```

Use actual IDs/numbers. Adoption creates no issue and changes no state, title, assignee or milestone. It preserves the full original intake body and comments, adds only missing managed labels, verifies the canonical identity, and saves the mapping/baseline under the import lock. Existing conflicting identities, concurrent body changes and unresolved creation intents stop the operation. Rerunning the same adoption is idempotent. The integration coordinator commits the registered scope and generated mapping; subsequent direct-main commits can reference the original intake number.

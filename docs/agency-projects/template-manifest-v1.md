# Template manifest v1, proposed data contract

31 October 2026. This source increment addresses the validation portion of AP-05.1 and T01/T11/T12. It is not an installer, workflow engine, persisted template store or accepted module. Owner review and the AP-05.1 dependencies remain open.

`parseTemplateManifestJson` accepts bounded UTF-8 JSON and returns a `Result`. The JSON boundary checks a 131,072-byte limit before parsing. Strict Zod objects reject unknown fields and unsupported schema versions. A semantic pass validates the graph after structural parsing. Schema and graph modules are implementation details; consumers use the JSON boundary rather than treating structural Zod success alone as graph acceptance.

## Manifest shape and limits

| Field | Contract |
| --- | --- |
| `schemaVersion` | Exactly 1. Other schema formats require a reviewed new validator. |
| `templateId`, entity IDs | Local identifiers matching `[a-z][a-z0-9_]{0,47}`. They are not CRM/user/contact UUIDs or identity mappings. |
| `version` | Publication version, an integer from 1 to 1,000,000. |
| `label` | Required `fa`, `de` and `en`, each nonblank and at most 160 characters. No control characters or line breaks. |
| `description` | Required `fa`, `de` and `en`, each nonblank and at most 2,000 characters. CR/LF are the only permitted control characters. |
| `roles` | 1 to 32 named roles, each `internal-producer` or `freelancer-contact`. A role is unresolved intent and grants no access. |
| `stages` | 1 to 32 named stages with explicit stage dependency IDs. |
| `deliverables` | Up to 128 named deliverables, each with a stage and responsible internal-producer role. |
| `intents` | Up to 256 unresolved follow-up, assignment or review records with explicit dependency IDs and offsets. |
| Dependencies | Up to 32 per stage and 256 per intent, without repeated edges, missing targets, self-dependencies or cycles. |

All entity IDs are unique across role, stage, deliverable and intent collections within one version. Unknown kinds, actions, extension keys, recipient fields, user/contact bindings, URL-fetch options and activation shortcuts are rejected. Free text is plain data; validation does not prove it contains no personal information or substitute for content review and Privacy inventory.

The three intent variants are:

- `follow-up`: stage, internal assignee role and explicit dependencies/offset.
- `assignment`: stage, deliverable, accountable internal-producer role and unresolved freelancer-contact role.
- `review`: stage, deliverable and internal reviewer/assignee role. It is a checkpoint, not a recorded approval.

Intent dependencies may point into the same stage or a declared ancestor stage. Assignment/review deliverables may likewise come from the same or a declared ancestor stage, allowing a later review checkpoint for an earlier production deliverable. Later or unrelated stage references fail. These constraints keep the stage/task graph unambiguous without executing it.

## Date intent and regional independence

Every intent has an explicit offset with `basis: "calendar-days"`, `anchor: "project-start"` and an integer `days` from -3,650 to 3,650. Negative offsets represent explicitly planned work before the chosen project start. This validator calculates no civil date or instant and chooses no calendar, timezone, workweek or holiday rules. Calendar owner agreement and an exact dated preview are required before installation. Workday offsets and automatic scheduling are unavailable in v1.

Persian ZWNJ and ordinary Persian/German/English text are preserved. C0, DEL, C1 and Unicode line/paragraph separator controls are rejected in labels; descriptions permit ordinary CR/LF newlines. Selecting a language does not change date intent or regional preferences. The synthetic test labels are not native-language review evidence.

## Version and installation contract

The proposed persistence rule is that a published `(templateId, version)` identifies one immutable manifest. Content edits publish a new version; installed projects retain their source version, stable local mappings and local overrides. This increment performs no persistence and therefore does not prove immutable publication, concurrent version creation, install idempotency or restore compatibility. TypeScript types and successful validation are not evidence for those guarantees.

No installer, identity mapper, recipient resolver, registry action, workflow publication, admission, reminder, sender or activation handler exists here. No existing WF action is imported or redefined. The existing registry was inspected read-only and has canonical activity/notification actions; using them remains a later owner-reviewed integration task. Installation must eventually use actual canonical activity/workflow commands and permission checks. Installing a template must not activate external effects.

## Scoped evidence

Pinned Bun 1.4.4, Vitest 5.0.5, one worker, task-owned checkout. Disk was above 4 GiB before these runs, with no install, build, database, browser or provider work in this increment.

```sh
PATH="$PWD/.runtime/bin:$PATH" bun run test:unit src/features/agency-projects/templates --maxWorkers=1
```

- `template-manifest-red-missing.log`: exit 1, two implementation modules absent before production code.
- `template-manifest-red-graph.log`: exit 1, 13 failed and 35 passed after structural validation, reproducing missing graph guards.
- `template-manifest-green.log`: exit 0, 48 passed for the first graph implementation.
- `template-manifest-red-controls-stage.log`: exit 1, 6 failed and 49 passed, reproducing C1/nonordinary line-break acceptance, tab acceptance and an overly restrictive later-stage review rule.
- `template-manifest-green-controls-stage.log`: exit 0, 55 passed after those corrections.

Logs are in the implementation chat's `work/` directory. Root records final formatted source checks and commit evidence. No runtime install/recovery, database immutability, native UI, reviewer, provider or release result is claimed.

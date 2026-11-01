# Immutable MAIL candidate metadata review

31 October 2026. Independent static review of exact commit
`571ba2cfd71361dfa886395bd10adc3b90cb0b8d`, tree
`dafe6a0e5e50de99b45469ec3226c935218226bd`.

**Result: the reviewed migration metadata and historical preservation checks pass.**
This is source evidence, not PostgreSQL execution, application adoption or release
qualification. No test runner, PostgreSQL, build, type check, install or browser was
started. Only this document was written; peer source, metadata, previews and trackers
were not changed. No commit was created.

## Object and source boundary

Git objects were read from `/Users/ali/Developer/warpdrive-mail-platform` using
`git show`, tree/blob inspection and independent in-memory comparisons. The observed
worktree HEAD was later `d616577fdb09ae57b0c67c2f657ba79b770df278`, with additional
dirty work. Neither that later commit nor the working tree was substituted for 571ba2c.
The candidate's own report is useful provenance, but its claimed test results were
not reused as independent execution evidence.

The exact reviewed merge has parents:

- `0fc4e470887006cf48179483b7135f45f9258f67`, which merges `61e1bdc` and `de74493`.
- `a697067c39d85fc7051a6847d95e569d0ff74ee0`, the platform allocation checkpoint.

The earlier `61e1bdcec7707dc2a6c241820b97fa04e660e7a3` merges platform
`b8b2708d4076551b803451ce10d4928a87ce35cd` and MAIL
`297c1dd5dbff4e19f6d1559a16bb258cc3368577`. Actual ancestor checks also pass for
MAIL safety `aab6c3d` through its MAIL descendant, the `27326c6` in-flight send-status
fix, `de74493` guides, platform `4099c9f` truthful copy and `45b722b` fake provider.
The candidate's `src/features/email/sendFailureOutcome.ts` blob exactly matches
`27326c6`; this follow-up was not lost in the combined merge.

The current platform comparison anchor was
`67eb151f228d9a2866d51266420e9fb915a77739`. Its historical migration objects through
0084 still match the platform source used by the candidate. This does not establish
that the candidate contains all later platform application/security/fixture changes.
Adoption must preserve those changes through an explicit forward reconciliation,
rather than replacing current platform source with the candidate tree.

References prefixed `C:` below mean immutable `571ba2c:path:line`. Original MAIL SQL
and snapshots are read at `297c1dd`; original platform metadata is read at `b8b2708`.

## Historical SQL, snapshots and journal

All **166 existing platform SQL/snapshot blobs numbered through 0084** were enumerated
from the actual platform tree and compared byte-for-byte with the candidate. There
were zero differences. The same paths have identical Git blob IDs at current platform
67eb151. This count concerns files actually present, not an assumption that every
historical number has a snapshot file.

The common 0082 snapshot is byte-identical between MAIL and platform, SHA-256
`3b26d54e4602737812ca9af0637e812df9b5d7cf198f34e2c78cd28f979dd54a`.
The candidate retains the platform journal's raw bytes through the closing brace of
entry 84, then appends a comma and the new entries. The SHA-256 of that retained raw
prefix is `9c1c1387b99ebd5c343a85ee23f193f1686ba4c3ba33f72ef3cbf89c00af8410`.
Parsed journal header fields and entries 0..84 also compare identically. The whole
journal file necessarily differs because entries are appended.

Journal indices are contiguous 0..90 and timestamps are strictly increasing across
the complete journal. Platform 84 remains `1793452709228`
(`C:drizzle/meta/_journal.json:594`). New entries 85..90 use
`1793452709229` through `1793452709234`, each greater than the preceding entry.
This avoids the silent-skip risk from the earlier isolated MAIL timestamps.

Every mapped SQL body is byte-identical to its original MAIL source:

| MAIL local source              | Candidate target               | SHA-256 of unchanged SQL body                                      |
| ------------------------------ | ------------------------------ | ------------------------------------------------------------------ |
| `0083_natural_deathstrike.sql` | `0085_natural_deathstrike.sql` | `3a91f34acc7a9ba493425fc703d739dfab7ca71cc5e568d9940e1c8b5b4fed9b` |
| `0084_military_loki.sql`       | `0086_military_loki.sql`       | `562d6affd4ddcb70a5d9baa0ba2ac076dd5e04b32e2113e759c18471725e04e2` |
| `0085_cooing_night_nurse.sql`  | `0087_cooing_night_nurse.sql`  | `87171bd516d517c20756b2ce09efedf7ea0a88cd6dba58d2635bdab21ee4157f` |
| `0086_early_tomas.sql`         | `0088_early_tomas.sql`         | `e98695888d8aec834ccdff77340d5123089b335d6f011e76d4815bd89e0b2a57` |
| `0087_cool_stryfe.sql`         | `0089_cool_stryfe.sql`         | `6b951166dd50bdc38ee2855d0044d3a948eff9b65c355a3fd3f970b08a540586` |
| `0088_skinny_slyde.sql`        | `0090_skinny_slyde.sql`        | `63f9f00ae03c629b64e84a40f9d69dd21685bcafb63cb2bef609630d10e35fb0` |

All table paths are under `drizzle/`. The candidate contains the six new SQL files,
six new snapshots and appended journal entries, without overwriting platform 83/84
with the isolated MAIL versions. Original local88 installed databases remain a
different history; this forward source chain does not qualify their upgrade.

## Independent cumulative structural comparison

The check did not execute the candidate reconciliation script. An independent
recursive comparison used actual common snapshot 82, complete platform snapshot 84
and each cumulative MAIL snapshot 83..88. Only top-level `id` and `prevId` were
excluded from structural equality. It compared every remaining key, including tables,
columns, constraints, indexes, enums, schemas, sequences, roles, policies, views and
`_meta`. Unchanged sides retain the other side; identical changes coalesce; conflicting
scalars/arrays or competing new values would be reported rather than discarded.

For all six stages the independently calculated merged structure equals the actual
candidate snapshot, with **zero conflicting paths**. All structural hashes below
were independently recalculated using sorted JSON object keys and preserved array
order; they match the candidate's published map
(`C:docs/mail-integrated-migration-map.md:24`).

| Integrated snapshot | Cumulative MAIL snapshot | Tables | Structural SHA-256 excluding IDs                                   |
| ------------------- | ------------------------ | ------ | ------------------------------------------------------------------ |
| 0085                | 0083                     | 89     | `990b1488dc92cd77b83c380f31ba4ff75ad9ea42c19ecf2576f2c22cc727ce7d` |
| 0086                | 0084                     | 90     | `a04a977b110051ea015640824b160a80cba011cde46b017913284caac6ac99eb` |
| 0087                | 0085                     | 92     | `d41406073dfc762523561914ff2d5b1c16727cb18258d7295f256605b2b44882` |
| 0088                | 0086                     | 92     | `34136c710ab84ae8f356d85f18c353078822d70c6a815a4510c95a08dcf25590` |
| 0089                | 0087                     | 92     | `97f74af2af8355c704dd78a8966f4e22912c3f9f71caa2d7fc65ca5971bb4065` |
| 0090                | 0088                     | 92     | `89cbe4c572fdc275828d9ffca7022e8c212fa145ab3ca0a4bf572511f9068056` |

Platform84 adds seven tables and makes no structural changes to common82 table objects.
Each complete added platform table object remains identical in every combined stage:
`integration_connections`, `integration_events`, `integration_oauth_attempts`,
`workflow_runs`, `workflow_steps`, `workflow_versions` and `workflows`, all in `public`.
This is stronger than merely observing their names in the final snapshot.

All six new snapshot IDs are valid, unique UUIDs, absent from both original histories.
Their `prevId` chain starts at platform84's
`d447ce0b-f2b8-4142-ab52-9b89b09d81af` and links without a gap:

| Snapshot | Fresh ID                               | Previous ID                            | Immutable ID line                         |
| -------- | -------------------------------------- | -------------------------------------- | ----------------------------------------- |
| 0085     | `3f898dbd-ab2e-441f-a769-620c8f1f77f9` | `d447ce0b-f2b8-4142-ab52-9b89b09d81af` | `C:drizzle/meta/0085_snapshot.json:10108` |
| 0086     | `01d9f4b8-083b-424b-8563-6df993fbac52` | `3f898dbd-ab2e-441f-a769-620c8f1f77f9` | `C:drizzle/meta/0086_snapshot.json:10235` |
| 0087     | `64e33723-f99b-4bba-9d20-7591fa031e53` | `01d9f4b8-083b-424b-8563-6df993fbac52` | `C:drizzle/meta/0087_snapshot.json:10638` |
| 0088     | `662809eb-8ec3-4799-9039-e34027f3be79` | `64e33723-f99b-4bba-9d20-7591fa031e53` | `C:drizzle/meta/0088_snapshot.json:10645` |
| 0089     | `0594f50a-9955-42c5-bafb-659b73355dba` | `662809eb-8ec3-4799-9039-e34027f3be79` | `C:drizzle/meta/0089_snapshot.json:10680` |
| 0090     | `9d8a2311-4709-469f-856e-5b3a3d7fc5d8` | `0594f50a-9955-42c5-bafb-659b73355dba` | `C:drizzle/meta/0090_snapshot.json:10686` |

The candidate's source explains the same intended boundary in
`C:scripts/mail-migration-plan.ts:73` and `C:scripts/mail-migration-merge.ts:93`.
Those helpers were inspected, not invoked, and their test files were not run.

## SQL-only safeguards still requiring PostgreSQL preservation

JSON snapshot equality cannot establish that SQL was applied, that backfills preserved
data, or that custom PostgreSQL objects survived an upgrade/restore. Preserve and
exercise at least these exact objects on a real disposable database:

| Source object                         | Immutable source                         | Required runtime evidence                                                                                                                                                                                                                   |
| ------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workflows_published_version_fk`      | `C:drizzle/0084_visual_workflows.sql:71` | Inspect actual composite FK and reject publishing a nonexistent version for that workflow. This SQL-only FK is absent from snapshot metadata.                                                                                               |
| `public.workflow_version_immutable()` | `C:drizzle/0084_visual_workflows.sql:74` | Inspect definition/search path and prove published-version UPDATE and DELETE raise `55000`. Function definitions are not represented by these snapshots.                                                                                    |
| `workflow_versions_immutable` trigger | `C:drizzle/0084_visual_workflows.sql:81` | Inspect actual enabled trigger and its target/function, then exercise it after clean install, upgrade and restore.                                                                                                                          |
| `public.warpdrive_base_currency()`    | `C:drizzle/0075_multicurrency.sql:3`     | Retain the historical function and verify the deals/leads/goals defaults use the current company base currency, without rewriting stored values. Snapshot defaults reference the function but do not preserve its definition by themselves. |
| `pgcrypto`, `citext` extensions       | `C:drizzle/0000_odd_warhawk.sql:1`       | Confirm required extensions and dependent types/functions exist under the target database/restore role. Snapshot table equality does not install extensions.                                                                                |

Also exercise represented safeguards, not only SQL-only objects: pinned workflow/run
version FK, published-number/admission/step uniqueness and check constraints; MAIL's
owner-default partial uniqueness, identity keys, locator same-account FKs, remote identity
checks and Gmail provider/generation backfills. In particular the mapped MAIL SQL creates
`email_messages_id_account_uq` before the locator FK that depends on it
(`C:drizzle/0087_cooing_night_nurse.sql:52`).

The bounded historical named-constraint scan also encountered the old
`deal_saved_filters_owner_id_users_id_fk`. That table is explicitly dropped by historical
0028 (`C:drizzle/0028_abandoned_beast.sql:1`), so its absence from the final snapshot is
not a lost constraint requiring restoration. No new metadata discrepancy was found here.

Existing workflow migration test source provides behavior examples for missing published
versions, cross-workflow pinned versions and immutable versions
(`C:src/db/integrationWorkflowMigration.integration.test.ts:72`, `:90`). Its source
presence is not evidence that the combined MAIL clean/84-upgrade/restore paths passed.

## Allocation and next adoption action

The allocator's current `docs/integration-execution/migration-allocation.md` reserves
**0085 through 0093 exclusively for MAIL; next unreserved 0094 is not allocated**.
The reviewed candidate ends at 0090. Locator sourceFingerprint 0091, delivery observations
0092 and notification binding/suppression 0093 are outside this immutable cut and remain
pending their own design/source/DDL/qualification. Older candidate prose does not release
those reservations or establish these features as implemented.

This review removes the specific static blocker that the 85..90 metadata might have
overwritten platform history, retained skipped timestamps, or omitted platform table
objects. No metadata repair is indicated by the inspected object. The next migration
adoption step is a coordinator-authorized disposable qualification campaign for a pinned
target: clean install, actual platform84-to-target upgrade, idempotent migrator rerun,
data/authority/certainty preservation and dump/fresh restore with SQL-only guard checks.
If the selected target adds 91..93 or changes SQL/metadata, independently review that exact
new cut and qualify its complete chain; this result does not transfer automatically.

Application adoption remains separate: preserve later platform security/UI/fixture work,
perform the shared-source/dependency/UI projection reconciliation recorded in
`mail-source-adoption-audit.md`, and run final exact-head gates only when the coordinator
releases the resource hold. Do not rewrite an installed local88 journal, reset either
preview, replace the existing worker/MAIL sender, or infer generic CONN/EVT runtime
implementation from this successful static metadata comparison.

## Independent review of the prepared platform/Mail merge

Later on 31 October, reviewed the actual uncommitted merge in
`/tmp/warpdrive-integration-mail-adoption-20261031`, branch
`codex/integration-mail-adoption-review`. Observed `HEAD` was
`67eb151f228d9a2866d51266420e9fb915a77739`, `MERGE_HEAD` was exact
`571ba2cfd71361dfa886395bd10adc3b90cb0b8d`, and common base was
`a697067c39d85fc7051a6847d95e569d0ff74ee0`. No merge commit existed at this review.

The initial automatic-merge index contained **4,215 stage-zero entries and zero unmerged entries**. There
were no tracked unstaged differences. All paths independently matched the ordinary
three-way selection from those immutable parents: an unchanged side retains the
other side, equal changes coalesce, and there were zero competing changed paths.
This is source/index consistency, not proof of cross-feature compatibility.

The initial projected staged Git tree SHA-1, calculated in memory without writing a Git
object, was `0743fd8450a9ed43088eb679833f0f2d40985a9f`. The calculation reproduced
the existing root commit's actual tree hash as a control. Full staged manifest
SHA-256 was `2b9f09c3962947455655039177b58031daa13bf487d23da2f1e458a3bd25a690`.
Manifest format is UTF-8 lines sorted by path, each `mode SP blobOID TAB path LF`.
A subsequent commit must be compared with this tree; changed source invalidates the
corresponding observations rather than inheriting review automatically.

The coordinator then added only `docs/integration-execution/mail-adoption-review-state.md`,
blob `cbdd47bb2726439c36af038ccc89174fa70ab705`. Independently recalculated final
staged tree: `e77fed321f2e080691934e267f38ff88d2236d30`, 4,216 stage-zero entries,
manifest SHA-256 `d9088315e0d0e30eb681fdafbfcc88a5479bd043bcaea75cadd2e3265ffefc86`.
Removing that one documentation entry reproduces the initial 0743 tree exactly.
No functional source changed; tracked unstaged and unmerged counts remained zero.

Every root blob in these groups was retained exactly:

| Root inventory                                 | Files | SHA-256 of path/mode/blob manifest                                 |
| ---------------------------------------------- | ----- | ------------------------------------------------------------------ |
| `src/test/integrationPlatformFixtures*.ts`     | 12    | `7f97b5f0ef766a2f201446c32a8635397f607a9f31c08c683ffb2e85cad8263f` |
| `src/features/workflows/`                      | 69    | `ccfd5071fe42a6bdd3ed67a6f3ff81e0ebb2797894e10564c193ffc8d0a7a2a8` |
| `src/features/integrations/`                   | 43    | `110b972d48302a9503050f34cc58e0e3e5ff52302b78f3d22a8b60fd817fa408` |
| Provider contract subdirectory, included above | 8     | `3e8d8e02bf5557970e5d8000dec0cbc04f6106bccd545881aae1ddd431705d0e` |
| `src/test/fakeProvider*.ts`                    | 10    | `0f0110af5aae121f8dde2e404c65292c7068d9ce979d9f58010154779bd26fc1` |

The retained integration group includes the current copy correction and semantic
mark. `next.config.ts`, instrumentation, app instrumentation, boss observer and
central worker also remain exact root blobs. Server-function argument logging stays
disabled (`next.config.ts:63`); workflow/integration message declarations remain
(`:100`, `:106`); the worker retains workflow registration, observed pg-boss errors
and publishing the singleton before registration (`src/server/worker.ts:12`, `:29`,
`:36`, `:40`). MAIL extends the existing email registration through the imported
domain files, without replacing this worker stack.

Staged `package.json` and `bun.lock` exactly match the combined candidate versions.
All direct dependency/dev-dependency/script/override entries from both parents are
preserved. Versions include `@xyflow/react` 12.12.0, `imapflow` 2.10.0, `mailparser`
3.14.1, `libphonenumber-js` 1.13.15 and development `smtp-server` 3.21.3.
The lock has 1,356 resolution entries versus root's 1,310: no root alias key or
resolved name/version disappears. All candidate entries are identical in the index.
The two previously reviewed serializer alias changes remain; older serializer/entity
versions are still resolved under other aliases. In particular `@xyflow/system`
0.0.83 and `@xyflow/react/zustand` 4.5.7 remain alongside `@xyflow/react` 12.12.0.
This preserves inventories, not frozen-install or runtime compatibility evidence.

Staged file SHA-256: package
`19a4be443bb6d5e51ac26b797596552fbd84c6f0ed81050dd5ef86fa74bcd6eb`;
lock `8c75e710af79b2faaa3db7c3a6a3bd530126752be393375f4eb42c3d1cd468d9`.

Remaining concrete boundaries, with paths relative to this prepared merge:

- **Fixture incompatibility requires a follow-up:**
  `src/test/integrationPlatformFixtures.integration.test.ts:165` expects a second
  same-owner mailbox insert to fail `23505`, and line 170 asserts the old one-mailbox
  limit. `drizzle/0085_natural_deathstrike.sql:1` drops that owner uniqueness
  constraint. The retained fixture source is therefore not qualified against the
  adopted MAIL schema. Update its stated limits and multi-account/ownership/default
  evidence under its owner, then run real-PostgreSQL red/green qualification.
- **UI projection remains incomplete:** settings connections still calls
  `getActorMailboxStatus` (`src/app/(app)/settings/connections/page.tsx:37`), whose
  MAIL implementation returns the default/first account
  (`src/features/email/mailboxOwnership.ts:54`). `ConnectionOverview.tsx:15` and
  `:26` still accept/count one status under the Gmail-oriented hub. Reconcile
  multi-provider labels/counts and pause/capability/error reasons without regressing
  the retained truthful copy, then qualify FA/DE/EN browser states.
- **Shared APIs remain design work:** native MAIL session/proof/account-generation
  fences are domain implementation; proposed generic CONN broker/lifecycle/grant
  projection and EVT admission/effect bindings are not made runtime services by this
  merge. Preserve one MAIL sender and the existing pg-boss/workflow engine.
- **Execution remains pending:** the metadata checks above do not replace integrated
  source/lint/type/unit/native-transport/real-PG tests, clean/84-upgrade/restore checks,
  frozen installs, application/worker builds or browser/provider qualification on the
  final selected head. This review ran none of them and does not accept reserved
  91..93 source or change any tracker status.

Conclusion for this merge: preservation and source inventory review pass, with the
explicit fixture incompatibility and UI/API qualification work retained as open.
An immutable review-branch commit can identify this unqualified source for subsequent
work; it is not evidence to promote the merge into a qualified platform baseline.

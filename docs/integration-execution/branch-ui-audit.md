# Branch, workflow and completed UI source audit

Snapshot: 31 October 2026, 14:15 Europe/Berlin. Preview source head:
`2f6098b13455fc241389df48b4d4a17f1eed77a7`.

This is source inventory for BASE-002 and BASE-003 and a reconciliation recommendation
for BASE-004. No peer files, refs, runtime services or configuration were changed. No network
fetch, push, merge, reset, stash or staging occurred during this audit. Counts are observations
of live peer work and can change immediately. Historical test reports below do not qualify a
reconciled tree.

## Ownership and branch boundaries

| Checkout                                       | Branch / exact HEAD                                                              | Observed state                             | Scope owner / boundary                                                                                                                                                                                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/tmp/warpdrive-integrations-preview-20261031` | `codex/integration-platform-preview`, `2f6098b13455fc241389df48b4d4a17f1eed77a7` | Clean at inventory start                   | This integration programme; eight completed UI commits and two plan commits. Later audit documents are current programme edits.                                                                                                                                         |
| `/tmp/warpdrive-integrations-20261031`         | `codex/integration-platform`, `01dd1dda4e4a6944f4bb46c7a504d6848a9ccae2`         | 313 dirty paths: 83 tracked, 230 untracked | Earlier implementation staging tree; contains auth/integration source also represented by later preview commits, but no blanket equivalence is assumed. Preserve it because preview Git metadata lives here. No current human/agent owner was independently identified. |
| `/Users/ali/Developer/warpdrive`               | `main`, `8539fe8c4aeb0b58b6d05e629710460ef90bbed4`                               | 10 dirty paths: 5 tracked, 5 untracked     | Peer auth/login-help work. Preserve LoginScreen, authScreens catalogs, LoginWorkflow test and new help/UI files. Exact active agent identity is not encoded in Git.                                                                                                     |
| `/Users/ali/Developer/warpdrive-calendar`      | `codex/calendar-workflows`, `9f0e9cc5f07381801be57e15b43c129bab9715bb`           | Clean                                      | Peer calendar implementation. Local committed event-editor slice; no provider sync, invitations or conferencing provisioned.                                                                                                                                            |
| `/Users/ali/Developer/warpdrive-integrations`  | `codex/local-integrations`, `8539fe8c4aeb0b58b6d05e629710460ef90bbed4`           | 296 dirty paths: 73 tracked, 223 untracked | Active independent-mail/local-provider programme. Mail model, connections, SMTP/IMAP, offboarding, phone/data conventions, tests and migrations are being edited. Do not bulk import or overwrite this tree.                                                            |
| `/private/tmp/warpdrive-workflows-20261031`    | `codex/visual-workflows`, `b8f25a41fccdb05e24e03d9ce07311a2798817d6`             | 64 dirty paths: 29 tracked, 35 untracked   | Active visual-workflow programme. Committed engine/editor plus newer uncommitted connectable editor and conditions. Do not treat the dirty tree as a released/committed version.                                                                                        |

`/tmp/warpdrive-better-auth-20261031` is a symlink to `/Users/ali/Developer/warpdrive`.
The main/calendar/local-integrations checkouts share that repository's Git common directory.
The workflow checkout is a separate clone. The integration preview and its earlier staging tree
share another Git common directory.

The main repository declares `origin=https://github.com/KhademOHAli1/warpdrive.git` and
`upstream=https://github.com/sneg55/warpdrive.git`. The workflow clone declares the same fork
origin. Both integration checkouts declare `origin=/tmp/warpdrive-better-auth-20261031` for
fetch and push. This is a local source, not the public fork. Remote tracking refs were read
without contacting GitHub and do not prove current remote heads. Do not push through the
integration origin or silently replace it.

## Committed auth and calendar relationship

`git merge-base 8539fe8 HEAD` in the preview returns the complete main/auth head
`8539fe8c4aeb0b58b6d05e629710460ef90bbed4`. The committed current auth baseline is already an
ancestor of the integration preview. The ten dirty auth paths are not part of that baseline.

The clean calendar branch adds one commit, `9f0e9cc5f07381801be57e15b43c129bab9715bb`, on the
same main/auth baseline. It changes 23 paths, none overlapping the preview's committed delta
from that baseline. The commit message and `docs/calendar-implementation-plan.md:1` describe
local creation/editing, preserved civil dates/stored instants, permission-checked reopening and
FA/DE/EN copy. Its documented 536 unit / 11 PostgreSQL results are peer historical evidence,
not current integration evidence. The plan explicitly keeps full calendar/provider delivery open
and asks for review alongside ongoing integration work.

## Located visual workflow implementation

The authoritative discovered peer source is `/private/tmp/warpdrive-workflows-20261031`,
branch `codex/visual-workflows`. Commits beyond common auth/main include:

- `3d44f593a6724af3446530a1b0612a9122fec17e`: visual workflow definitions and documentation.
- `8503d91d8eed5b31b58087dfca16a335337c6a07`: manual workflow execution and localized editor.
- `40deb8acd3a21b620c8e101249647993efa793f4`: incorporate Better Auth main and sequence workflow migrations.
- `3833eaf27edb8e1dc8d09b86d63334b1e843164b`: qualify workflow UI on auth baseline and document supported scope.
- `b8f25a41fccdb05e24e03d9ce07311a2798817d6`: normalize saved draft state.

The committed `b8f25a4:docs/workflows/status.md` supports manual start, visible deal reads and
undated follow-up tasks assigned to the initiator. It reports 5,733 unit tests, 19 real-DB
workflow tests, real pg-boss recovery and a synthetic local browser journey. Those are peer
reported historical checks, not rerun by this audit. Committed registry entries for later actions
do not establish executable support.

The current dirty `docs/workflows/status.md:9` additionally describes connectable nodes,
exclusive text/boolean conditions and 21 DB cases. That status and its underlying conditions,
graph editing and UI files are uncommitted at this snapshot. Do not attribute those features or
checks to `b8f25a4`. The runtime preview on loopback port 3116 and its separate PostgreSQL
cluster on 55435 are peer resources identified by the parent inventory; this audit did not
restart or qualify them.

`docs/workflows/status.md:34`, `docs/workflows/architecture.md:57`, and the committed status
all leave transactional CRM trigger outbox/automatic admission unfinished. The existing manual
engine already uses pg-boss and durable run progress. Reuse it rather than creating a second
workflow engine; coordinate new event ownership with that programme.

Independent mail has its own live handoffs:
`/Users/ali/Developer/warpdrive-integrations/docs/local-integrations-plan.md:1` and
`docs/local-integrations-progress.md:3`. The progress file changed during this audit and now
reports IG-01 through IG-06 implementation/checkpoints in progress. It explicitly retains
final build/lint/browser/migration/provider gates. Treat all those changes as active peer scope,
including `src/features/connections/`, mailbox ownership, encrypted credentials, lifecycle,
mail outbox and auth offboarding. They overlap planned CONN/MAIL and must not be independently
reimplemented without a reviewed source boundary.

## Migration and shared-file collisions

The preview commits `drizzle/0083_integration_connections.sql` and journal index 83. The
workflow branch commits `drizzle/0083_visual_workflows.sql`, also index 83. Both contain
`drizzle/meta/0083_snapshot.json`. The independent-mail dirty branch also starts migrations at
0083 and currently extends through 0088. Neither equal sequence numbers nor equal filenames
mean equal schemas.

Committed workflow vs preview deltas share six paths:

- `drizzle/meta/0083_snapshot.json`
- `drizzle/meta/_journal.json`
- `next.config.ts`
- `src/constants/errorIds.ts`
- `src/db/schema/index.ts`
- `src/features/i18n/catalog.ts`

Workflow also introduces package/lockfile changes, navigation, permission flags, worker
registration and tRPC routes. These may merge textually but still require integrated regression.
Migration reconciliation must preserve already applied migration identities/hashes in each
existing preview, retain integration 0083 and append workflow SQL as integrated 0084, generate
a combined 0084 snapshot with both schema families, and record a deliberate upgrade path.
The original workflow SQL and its checks must remain intact in the integrated migration. Do not edit already-applied peer migrations in place or point the
combined tree at an existing peer database. Preserve manual guards in the workflow SQL
(immutable published versions and same-workflow publication pointer).

## Eight completed UI commits

The following full hashes were read from Git and match the portable handoff's
`evidence/commits.txt`. Affected paths below are exact per-commit file inventories.

### `a5d8ea071d8382925750381b404e46153e331bb6`

Replace integration initials with local provider logos

```text
public/integrations/chatgpt.svg
public/integrations/claude.svg
public/integrations/gmail.svg
public/integrations/google-calendar.svg
public/integrations/microsoft365.svg
public/integrations/slack.svg
public/integrations/zoom.svg
src/features/integrations/IntegrationMark.test.tsx
src/features/integrations/IntegrationMark.tsx
src/features/integrations/integrationAssets.unit.test.ts
third-party/integration-logos-LICENSE.txt
third-party/integration-logos.md
```

### `e24834a20fb7ed533662afa52e812e027098320e`

Give each integration its own searchable identity

```text
public/integrations/cal-com.svg
public/integrations/calendly.svg
public/integrations/dropbox.svg
public/integrations/github.svg
public/integrations/google-drive.svg
public/integrations/jira.svg
public/integrations/linear.svg
public/integrations/make.svg
public/integrations/n8n.svg
public/integrations/onedrive.svg
public/integrations/stripe.svg
public/integrations/whatsapp.svg
public/integrations/zapier.svg
src/features/integrations/IntegrationHub.tsx
src/features/integrations/IntegrationMark.tsx
src/features/integrations/catalog.ts
src/features/integrations/catalog.unit.test.ts
src/features/integrations/integrationAssets.unit.test.ts
src/features/integrations/messages/integrations.de.json
src/features/integrations/messages/integrations.en.json
src/features/integrations/messages/integrations.fa.json
third-party/integration-logos.md
third-party/simple-icons-LICENSE.txt
```

### `84d4868a292f4c955712461574220afc31ec16dd`

Drive integration cards from real connection state

```text
src/app/(app)/settings/connections/page.tsx
src/features/integrations/ConnectionBadge.tsx
src/features/integrations/IntegrationHub.test.tsx
src/features/integrations/IntegrationHub.tsx
src/features/integrations/connectionState.ts
src/features/integrations/connectionState.unit.test.ts
src/features/integrations/messages/integrations.de.json
src/features/integrations/messages/integrations.en.json
src/features/integrations/messages/integrations.fa.json
```

### `b1d23a29f9888cede42a0c9aaa489cb84105eb54`

Prioritize active connections and separate the roadmap

```text
src/features/integrations/ConnectionOverview.tsx
src/features/integrations/IntegrationCard.tsx
src/features/integrations/IntegrationDirectory.tsx
src/features/integrations/IntegrationHub.test.tsx
src/features/integrations/IntegrationHub.tsx
src/features/integrations/messages/integrations.de.json
src/features/integrations/messages/integrations.en.json
src/features/integrations/messages/integrations.fa.json
```

### `16bbe58a5bd3d4c201d21ef791a9094c4c94de8a`

Polish provider details and separate operator setup

```text
src/features/integrations/IntegrationDetails.tsx
src/features/integrations/IntegrationHub.test.tsx
src/features/integrations/IntegrationHub.tsx
src/features/integrations/ProviderSummary.tsx
src/features/integrations/SlackServerSetup.tsx
src/features/integrations/messages/integrations.de.json
src/features/integrations/messages/integrations.en.json
src/features/integrations/messages/integrations.fa.json
```

### `0926c70a11230192a53704eae33c9282027a6e6f`

Show connection ownership, access and recovery details

```text
src/app/(app)/settings/connections/page.tsx
src/db/schema/integrations.ts
src/features/integrations/ConnectionFacts.tsx
src/features/integrations/ConnectionOverview.tsx
src/features/integrations/IntegrationHub.test.tsx
src/features/integrations/IntegrationHub.tsx
src/features/integrations/SlackConnection.test.tsx
src/features/integrations/SlackConnection.tsx
src/features/integrations/actions.ts
src/features/integrations/connectionState.ts
src/features/integrations/messages/integrations.de.json
src/features/integrations/messages/integrations.en.json
src/features/integrations/messages/integrations.fa.json
src/features/integrations/service.integration.test.ts
src/features/integrations/service.ts
src/features/integrations/useSlackConnection.ts
```

### `3bb812f3e514ab8aaa9ca41ee659df21cd2ddf64`

Add localized AI workflow previews and permission guidance

```text
src/features/integrations/IntegrationMark.tsx
src/features/integrations/McpSetup.test.tsx
src/features/integrations/McpSetup.tsx
src/features/integrations/McpWorkflowExamples.tsx
src/features/integrations/messages/integrations.de.json
src/features/integrations/messages/integrations.en.json
src/features/integrations/messages/integrations.fa.json
```

### `e321126f98a37a376e72ab0e4513e0c5b003f2b5`

Complete responsive RTL and keyboard refinement with verification

```text
docs/integration-platform-report.md
docs/integration-ui-polish.md
docs/integration-ui-research.md
public/integrations/dropbox.svg
public/integrations/github.svg
public/integrations/gmail.svg
public/integrations/google-calendar.svg
public/integrations/google-drive.svg
public/integrations/jira.svg
public/integrations/slack.svg
src/app/(app)/settings/SettingsNav.test.tsx
src/app/(app)/settings/SettingsNav.tsx
src/features/integrations/ConnectionOverview.tsx
src/features/integrations/IntegrationDirectory.tsx
src/features/integrations/IntegrationHub.test.tsx
src/features/integrations/IntegrationHub.tsx
src/features/integrations/McpSetup.tsx
src/features/integrations/McpWorkflowExamples.tsx
src/features/integrations/integrationAssets.unit.test.ts
src/features/integrations/messages/integrations.de.json
src/features/integrations/messages/integrations.en.json
src/features/integrations/messages/integrations.fa.json
third-party/integration-logos.md
```

## Historical UI acceptance evidence

Source evidence: `docs/integration-ui-polish.md:9` maps all eight behaviors to verification;
`:30` records FA/DE/EN, RTL, 320/390/768/1440 layouts, keyboard/focus and theme checks;
`:51` states that realtime port 8080 was refused and not qualified;
`:58` records the final check matrix. `docs/integration-platform-report.md:32` identifies the
merged auth baseline and source-equivalent auth head.

Portable evidence root:
`/Users/ali/Documents/Codex/2026-10-29/https-github-com-sneg55-warpdrive-git/outputs/integration-polish-20261031/`.

| Evidence file                                | Historical result / boundary                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `evidence/commits.txt`                       | Eight hashes listed above.                                                          |
| `evidence/unit-tests.log`                    | 89 tests, 16 files passed at UI refinement.                                         |
| `evidence/integration-tests.log`             | 43 tests, 13 files passed against real PostgreSQL/MCP/OAuth.                        |
| `evidence/production-build.log`              | Bun 1.4.4 / Webpack build recorded passing.                                         |
| `evidence/typecheck.log`                     | TypeScript check recorded passing.                                                  |
| `evidence/lint-and-i18n.log`                 | Full lint and i18n recorded passing, 11 retained Biome warnings.                    |
| `evidence/shadcn-audit.log`                  | 23 generated registry files recorded unchanged.                                     |
| `evidence/browser-checks.md`, `screenshots/` | Synthetic local workflow, direction/layout/focus evidence. No live provider grants. |

The source bundle and README in that root explain independent restore. Preserve the completed
provider assets, catalog/search/state-driven cards, real owner/scope/recovery DTOs, workflow
prompt previews, responsive settings navigation and all three contextual catalogs. No live
Slack/Google/ChatGPT/Claude qualification or marketplace operation is established by this evidence.

## Recommended isolated reconciliation

1. Keep the existing preview branch as the preservation anchor. Record exact heads and dirty
   manifests again immediately before any mutation. Keep all peer worktrees and services intact.
2. Committed auth/main `8539fe8` already belongs to this history. Do not copy the dirty auth
   login/help tree or repeat the auth migration. Record its peer ownership as deferred integration.
3. Import reviewed immutable peer commits into explicit local source refs using their checkout
   paths, never a generic push. The current candidate workflow cut is `b8f25a4`, excluding its
   dirty connectable-editor/conditions work. The calendar candidate is clean `9f0e9cc`. Use a
   separate integration candidate branch/worktree for merge and test, retaining the UI anchor.
4. Reconcile workflow shared schema/catalog/error/Next files deliberately. Retain the applied integration
   `0083_integration_connections.sql` and its metadata. Append the original workflow migration
   SQL/checks at integrated 0084, regenerate the combined 0084 schema snapshot, and append a
   unique journal entry. Verify fresh-install and integration-0083 upgrade paths with real
   PostgreSQL. Do not reuse either branch's 0083 snapshot as the combined state. Retain applied peer files in their
   own histories and disposable databases. Do not silently choose one conflicting snapshot.
5. Preserve the current connection UI during navigation/catalog merges. Run its focused unit/DB
   regressions alongside workflow publication/admission/cancellation/pg-boss tests, then calendar
   draft/date/permission tests. Rerun build/type/lint/i18n/UI registry checks on the exact combined
   head. Start worker and authenticated realtime against only the new isolated profile.
6. Do not copy the changing independent-mail working tree. Reuse its documented identity,
   generation-fencing and lifecycle contracts in architecture decisions, then reconcile a later
   reviewable committed handoff. Reserve mailbox/SMTP/IMAP/offboarding implementation for that
   peer in the meantime. The integrated migration plan must account for its existing 0083-0088
   sequence before eventual shared release.
7. BASE-004 closes only after the chosen committed reconciliation and its tests pass. This audit
   closes source discovery/UI mapping, not reconciliation/runtime qualification. Any newer peer
   commits or dirty-source adoption require a fresh source/evidence snapshot.

Only `docs/integration-execution/branch-ui-audit.md` was written by this audit owner. No
production code or database was changed and no commit was created.

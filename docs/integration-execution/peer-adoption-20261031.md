# Committed peer adoption audit, 31 October 2026

Snapshot: 31 October 2026, 15:30 Europe/Berlin.

Scope: read-only source inventory before the next isolated reconciliation. No fetch, merge,
index/ref update, peer file change, service change or new qualification run was performed.
Only this audit document is written. Local `git merge-file -p` compared current/base/peer
contents in memory for conflict prediction; it did not write merged files or Git objects.

## Exact adoption candidates and ownership

Preview anchor: `d164fc18f006744aaf7bdd6094b688c59104a50c`, branch
`codex/integration-platform-preview`, `/tmp/warpdrive-integrations-preview-20261031`.

| Source | Adopted cut | Reviewable next cut | Ownership and exclusions |
| --- | --- | --- | --- |
| Main/auth, `/Users/ali/Developer/warpdrive` | `8539fe8c4aeb0b58b6d05e629710460ef90bbed4` | `a1a8f6da1ce366c35002900bf33508356dfbb995` | Two committed auth/help/recovery changes. Tracked source is clean; two untracked privacy-planning documents remain peer-owned and excluded. |
| Workflows, `/private/tmp/warpdrive-workflows-20261031` | `b8f25a41fccdb05e24e03d9ce07311a2798817d6` | `d0c83e8ad0ed07097f40bec82727976d022b7742` | Clean committed node-builder/conditions cut. Its separate `codex/workflow-builder-ux` worktree has 37 dirty paths and is excluded. |

Main/auth commits:

- `cab655877954fd1b5ddd72824c8912451087a71b`: refine sign-in help and qualify password recovery.
- `a1a8f6da1ce366c35002900bf33508356dfbb995`: align locale-shell assertions with refined sign-in copy.

Workflow commit:

- `d0c83e8ad0ed07097f40bec82727976d022b7742`: connect nodes and execute localized conditional processes.

The preview's application source is clean. Its nine dirty paths are incoming peer planning:
three tracked `docs/integration-platform-{plan-summary.json,plan.md,tasks.csv}` files and six
untracked coordination/SMS/handoff files. They remain outside this adoption and outside the
active 446-task execution register until the owner reconciles the proposed 586-row amendment.

Other live worktrees at the source snapshot:

| Checkout / HEAD | Dirty paths | Boundary |
| --- | --- | --- |
| `/Users/ali/Developer/warpdrive`, `a1a8f6da1ce366c35002900bf33508356dfbb995` | 2 untracked | `docs/PRD-warpdrive-privacy-data-lifecycle.md`, `docs/privacy-data-lifecycle-tasks.md`; do not stage/import. |
| `/Users/ali/Developer/warpdrive-integrations`, same main/auth head | 456: 143 tracked, 313 untracked | Active independent mail, data conventions, SMS and shared-binding work. Import only a later acknowledged immutable handoff. Its source, migrations, lockfile and tests are excluded here. |
| `/private/tmp/warpdrive-workflows-20261031`, `d0c83e8ad0ed07097f40bec82727976d022b7742` | 0 | Safe source for the selected committed cut. |
| `/private/tmp/warpdrive-builder-ux-20261031`, same workflow head | 37: 20 tracked, 17 untracked | Active connection gestures, history/trace and canvas improvements. No dirty-source adoption or test inheritance. |
| `/Users/ali/Developer/warpdrive-calendar`, `2803183809c646a063f78fe954c110adbb2f453f` | 65: 34 tracked, 31 untracked | Newer calendar peer work is outside the two requested adoption candidates. Preserve current adopted calendar implementation and all peer changes. |

Counts describe changing peer state, not a freeze or permission to alter it. Recheck immediately
before adoption. Main/auth and calendar/mail share their repository metadata. Workflow and
builder-UX share separate workflow-clone metadata. The preview still depends on
`/tmp/warpdrive-integrations-20261031`; keep both. Its `origin` still points to the local auth
checkout. No GitHub synchronization or push was performed by this audit.

## Exact committed path deltas

### Auth: `8539fe8` to `a1a8f6d`

18 paths, 958 insertions and 63 deletions, plus the changed local screenshot. Status letters
below are the exact `git diff --name-status` result:

```text
A	docs/auth-recovery-verification.md
M	docs/auth-ui-design.md
M	docs/images/auth/login-fa-mobile.png
A	src/app/(auth)/auth/help/page.tsx
A	src/constants/authUi.ts
M	src/features/auth/LoginScreen.tsx
M	src/features/auth/better/auth.ts
A	src/features/auth/better/passwordReset.security.integration.test.ts
A	src/features/auth/better/passwordReset.smtp.integration.test.ts
M	src/features/auth/messages/authScreens.de.json
M	src/features/auth/messages/authScreens.en.json
M	src/features/auth/messages/authScreens.fa.json
A	src/features/auth/ui/LoginHelpWorkflow.test.tsx
M	src/features/auth/ui/LoginWorkflow.test.tsx
A	src/features/auth/ui/SignInHelpScreen.test.tsx
A	src/features/auth/ui/SignInHelpScreen.tsx
M	src/features/i18n/localeUi.test.tsx
A	src/test/authSmtpSink.ts
```

The source changes pair password/passkey controls, add the shared sign-in-help route and
contextual FA/DE/EN copy, suggest reset after repeated rejected passwords, and explicitly keep
Better Auth origin/CSRF checks enabled in test qualification. It does not rewrite the CRM shell,
connection catalog, calendar, mailbox transport or application ownership model.

### Workflow: `b8f25a4` to `d0c83e8`

64 paths, 2,603 insertions and 480 deletions, plus local workflow-review screenshots:

```text
M	README.md
M	docs-site/docs/architecture.md
M	docs-site/docs/features/automations.md
M	docs-site/docs/intro.md
M	docs/README.md
A	docs/images/workflows/node-review/fields-fa-mobile.jpg
A	docs/images/workflows/node-review/graph-de-focus.jpg
A	docs/images/workflows/node-review/graph-de-mobile.jpg
A	docs/images/workflows/node-review/graph-en.jpg
A	docs/images/workflows/node-review/graph-fa-focus.jpg
A	docs/images/workflows/node-review/graph-fa-mobile.jpg
A	docs/images/workflows/node-review/history-fa-current.jpg
A	docs/images/workflows/node-review/run-fa.jpg
M	docs/workflows/architecture.md
M	docs/workflows/implementation-plan.md
M	docs/workflows/operations.md
M	docs/workflows/status.md
M	docs/workflows/ui-review.md
A	src/features/workflows/condition.integration.test.ts
A	src/features/workflows/condition.test.ts
A	src/features/workflows/condition.ts
M	src/features/workflows/editorModel.test.ts
M	src/features/workflows/editorModel.ts
A	src/features/workflows/editorTemplates.test.ts
M	src/features/workflows/execution.ts
A	src/features/workflows/graphEditor.test.ts
A	src/features/workflows/graphEditor.ts
A	src/features/workflows/mappingOptions.test.ts
A	src/features/workflows/mappingOptions.ts
M	src/features/workflows/messages/workflows.de.json
M	src/features/workflows/messages/workflows.en.json
M	src/features/workflows/messages/workflows.fa.json
A	src/features/workflows/nodeFactory.ts
A	src/features/workflows/nodeLayout.ts
A	src/features/workflows/nodeNames.test.ts
A	src/features/workflows/nodeNames.ts
M	src/features/workflows/readiness.ts
M	src/features/workflows/registry.ts
M	src/features/workflows/runActions.ts
M	src/features/workflows/runBindings.ts
M	src/features/workflows/schemas.ts
A	src/features/workflows/ui/BindingField.tsx
A	src/features/workflows/ui/BuilderFrame.tsx
A	src/features/workflows/ui/BuilderWorkspace.tsx
A	src/features/workflows/ui/ConditionFields.test.tsx
A	src/features/workflows/ui/ConditionFields.tsx
A	src/features/workflows/ui/ConditionValue.tsx
A	src/features/workflows/ui/ConnectionEditor.tsx
A	src/features/workflows/ui/DefinitionIssues.tsx
A	src/features/workflows/ui/EdgeInspector.tsx
M	src/features/workflows/ui/NodeInspector.test.tsx
M	src/features/workflows/ui/NodeInspector.tsx
A	src/features/workflows/ui/NodePalette.tsx
A	src/features/workflows/ui/ResponsiveViewport.test.tsx
A	src/features/workflows/ui/ResponsiveViewport.tsx
M	src/features/workflows/ui/RunDialog.tsx
A	src/features/workflows/ui/WorkflowCanvas.test.tsx
M	src/features/workflows/ui/WorkflowCanvas.tsx
M	src/features/workflows/ui/WorkflowEditor.tsx
M	src/features/workflows/ui/WorkflowLibrary.tsx
A	src/features/workflows/ui/WorkflowNodeCard.tsx
M	src/features/workflows/ui/useWorkflowEditor.ts
M	src/features/workflows/ui/workflowCanvas.css
A	src/features/workflows/ui/workflowLocale.test.tsx
```

The source adds explicit graph connections and reconnection, stored node positions, localized
automatic node names, typed ancestor mapping choices, an editor/focus workspace and exclusive
text/boolean conditions. The executor chooses the `true` or `false` port only for a condition;
other supported steps retain `next`. Bindings now reject inherited properties. The published
scope remains manual start, visible deal reads and undated self-assigned follow-up tasks plus
the new limited conditions. Automatic record triggers/outbox, waits and external sends remain
unfinished. The registry is not proof of unsupported handlers.

## Migration and dependency result

Neither proposed delta changes `drizzle/`, its journal/snapshots, `package.json`, `bun.lock`,
`AGENTS.md` or `CLAUDE.md`. No new dependency install, migration renumbering or regenerated
snapshot is required solely by these two cuts.

Retain the integrated migration chain: integration `0083_integration_connections.sql`, then
integrated `0084_visual_workflows.sql` and its combined snapshot. The source workflow branch
still describes its own original 0083 history; that is historical peer qualification, not an
instruction to restore its divergent journal. Do not import the mail peer's 0083-0088 dirty
migrations. Current integration migration reservations and acknowledged binding ownership remain
in force.

Workflow JSON schema version remains 1. New `nameMode` and `layout` fields are optional, so old
saved definitions without them need round-trip regression rather than a database schema
migration. Preserve immutable published versions and pinned runs; adopting a new editor must
not rewrite old definitions or grant new capabilities. Conditions add only their validated
operators and supported text/boolean behavior; grouped/money/numeric semantics remain open.

## Pre-merge prediction and actual reconciliation result

At the initial inventory, both next-cut objects were absent from the preview object database.
This audit owner performed no fetch. The initial prediction below used base/current/peer file
contents with `git merge-file -p`; it was an advisory per-file prediction, not a full repository
merge result. The execution owner subsequently imported the immutable cuts and performed the
actual merges described after the prediction:

- Auth: none of its 18 changed paths differs between the preview HEAD and adopted auth base.
  No content conflicts are predicted for this delta.
- Workflow: only `README.md` overlaps the preview's changes from adopted workflow base. Git
  predicts two text-conflict hunks there. Its other 63 paths have no competing preview delta.
- Auth and workflow target path sets are disjoint. Adopting auth first should not introduce a
  new overlap into the workflow source delta.

Predicted README hunk 1, near the Calendar roadmap: retain the preview's implemented localized
calendar-event editor and `docs/calendar-implementation-plan.md` link. Reject the peer's stale
claim that calendar implementation is documentation-only/deferred. Keep external calendar sync,
Meet/Zoom/Teams provisioning labelled planned.

Predicted README hunk 2, near the workflow summary: adopt the new explicit-connections, saved-position
and conditional-branch description, retaining its early-access/manual scope and open broader R1
statement. Preserve the rest of the current README, including independent integration progress
and current UI wording. No wholesale ours/theirs resolution is justified.

Actual result, checked before the owner's workflow merge commit: the execution owner reports
that auth adoption succeeded and `git merge --no-commit --no-ff` for the workflow cut also
merged `README.md` automatically, with no textual conflict. The actual repository merge result
supersedes the per-file conflict prediction. Do not report two conflicts as an actual event.

This audit owner then read the staged `:README.md` directly without changing or staging it.
The index already preserves both intended outcomes:

- Staged README lines 196-202 retain the calendar workflow specification, the implemented
  localized event-editor slice and `docs/calendar-implementation-plan.md`; only external sync
  and Meet/Zoom/Teams remain planned. The peer's stale documentation-only/deferred calendar
  wording is absent. No calendar correction is required in this staged result.
- Staged README lines 215-219 include explicit node connections, saved positions, conditional
  branches, deal reads and follow-up tasks, with FA/DE/EN and the broader R1 still in progress.

The staged text therefore needs no correction for the two predicted hunks. Keep that content
in the final merge commit and record its exact head with subsequent qualification evidence.
Only this audit record changed during the follow-up; final README and merge ownership remain
with the execution owner.

## Qualification needed after the owner's merge

Peer results are historical evidence only:

- Auth `docs/auth-recovery-verification.md` reports 95 auth unit cases, 164 PostgreSQL cases
  across 42 files, local SMTP reset delivery and localized browser review; commit `a1a8f6d`
  reports 119 auth/localization unit cases after locale-shell assertions. Plaintext loopback
  SMTP does not qualify production TLS or external delivery, physical passkeys or real tenants.
- Workflow `docs/workflows/status.md` reports 5,753 broad unit cases, 21 real-PostgreSQL workflow
  cases, a later 43-case focused node-builder suite, worker/app/docs builds and synthetic local
  browser runs. The broad run precedes its final measurement regression. The original workflow
  migration chain differs from the integrated chain; rerun here.

Suggested current-source checks with Bun 1.4.4:

```sh
export PATH=/tmp/warpdrive-bun144/bin:$PATH
bun run test:unit src/features/auth src/features/i18n/localeUi.test.tsx src/features/workflows src/features/integrations
DOCKER_HOST=unix:///Users/ali/.colima/warpdrive/docker.sock TESTCONTAINERS_RYUK_DISABLED=true bun run test:integration src/features/auth src/features/workflows src/db/integrationWorkflowMigration.integration.test.ts --maxWorkers=2
bun run typecheck
bun run lint
bun run ui:check
bun run build:workers
```

Use the existing private build-only configuration for the production app build, before the dev
app starts sharing `.next`; never print or commit it. Build success is compile evidence, not
running-service acceptance. If the source reconciliation exposes broader failures, broaden to
the relevant full lane under the taxonomy rather than transferring old counts.

Changed auth tests: password-reset security and loopback SMTP integration; LoginHelpWorkflow,
LoginWorkflow, SignInHelpScreen and locale-shell unit tests. Existing MFA/recovery/session and
wrong-origin regressions must remain green because origin/CSRF behavior is intentionally explicit.

Changed workflow tests: condition unit and PostgreSQL branches; editorModel/editorTemplates,
graphEditor/mappingOptions/nodeNames; ConditionFields, NodeInspector, ResponsiveViewport,
WorkflowCanvas and workflowLocale. Keep existing persistence, admission, competing-worker,
visibility, cancellation and real pg-boss recovery cases. Test old definitions without optional
layout/nameMode and edited/reloaded new definitions.

UI preservation checks after reconciliation should verify the existing CRM shell, connection
catalog's 21 IDs and state-driven controls, calendar event editor, auth help/return navigation,
Farsi/German/English direction/copy, graph/ordered editing, both condition paths, simulation and
current manual run behavior. These are scoped regression expectations, not a new visual redesign
or a claim that this audit ran a browser. Preserve mobile/focus/shared shadcn adapters.

## UX-002 discovery and remaining evidence

The active UX-002 acceptance requires inspected integration, automation, permission-review and
app-management flows with exact links and applied patterns, without copying assets. It also
depends on UX-001. This audit does not mark it complete.

Existing evidence is useful but narrower:

- `docs/integration-ui-research.md:8-13` records two previously inspected Attio flows for
  integration discovery/Slack workspace management and Google Calendar connect/consent.
  `:38-40` explicitly defers app-detail, permission-review, install/update/uninstall and
  publisher/developer screens. These are historical observations, not freshly inspected pages.
- `docs/workflows/ux-design-reference.md:19-28` records ten previously inspected Attio/Zapier
  automation flows, with exact captured frames and applied patterns: creation, filters,
  conditions, publication, validation, run detail, timezone, library sorting, connection check
  and focused editing. It does not supply an actual app install/update permission-diff flow.
- No new Mobbin page, image or live product was inspected during this source audit. Do not
  invent a reference, count these old notes as a new research session, or infer product runtime
  behavior from captured UI.

Tool discovery at this snapshot found no available tool named/described for Mobbin. The
read-only Plugin Management search with query `Mobbin`, limit 5, returned an empty plugin list.
This does not prove that Mobbin never has a plugin; it records the current capability result.
No installation or permission change was requested/performed.

Available fallback routes include `mcp__playwright__browser_tabs`, `browser_snapshot` and
`browser_navigate`, plus the enabled computer-use surface `mcp__cua_repl.js` (beginning with
`cua.getState()`). Inventory the selected browser surface and use the one that actually has
authorized Mobbin access, then search captured flows and inspect their frames through that UI.
Do not assume the Playwright context shares Chrome authentication. Existing
notes report an authenticated Chrome session historically; this audit has not verified its
current login state. If no signed-in browser session is present, that access is a separate
resource requirement. Do not treat a public search snippet or guessed URL as inspected frames.

Next actual research should cover permission disclosure and reconnect/revoke; app discovery,
install consent, version permission changes/update review, disable/uninstall/data retention;
and how automation action setup uses those connections. Record real URLs, inspected frame
numbers, concrete observations and chosen Warpdrive patterns, with explicit differences from
our own grant/runtime design. Keep screenshots/assets out of redistribution. UX-002 stays
planned/in progress until its actual acceptance evidence is supplied.

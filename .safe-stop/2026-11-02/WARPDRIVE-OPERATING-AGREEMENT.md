# Warpdrive operating agreement

Effective 1 November 2026. This implements Ali's operating-model reset.

## Integration and ownership

`Warpdrive settings UX audit and Mobbin…` (chat `01a19251-a472-7cd1-86cd-8dc245dd5b84`) is the sole integration contact, canonical-main writer and heavy-job scheduler. `Assess Warpdrive Farsi and Bun migration` returns to MAIL implementation. No module reports through MAIL for scheduling or permission.

Each module owns its implementation, private helpers, fixtures, tests, messages, UI and normal generated artifacts in its existing task-owned workspaces. Routine work within that responsibility proceeds autonomously. New helper/test filenames, formatting, ordinary bug fixes and normal type-generation outputs do not require individual grants. Existing narrower per-file and plan-hash permissions are superseded for this routine work; their old test receipts, failures and preservation records remain historical evidence.

| Owner / chat | Durable responsibility |
| --- | --- |
| Sales — `01a19263-b767-7611-9ee3-f395e66557ac` | Deals, deal workspace, pipelines, leads, contacts, sales qualification/process templates, saved filters and sales statistics, with their routes/UI. Also Activities' `next-action-queue`, `NextActionQueue*` and `nextActionQueueProcedure.ts`. |
| Calendar / Activities — `01a19290-d076-74e2-ac3f-46c9853bc5b5` | Remaining `src/features/activities/**`: event/activity CRUD, completion, visibility, temporal conversion, reminders, lists/forms and calendar presentation, including Calendar's private provider work. |
| Workflow — `01a1929d-3672-79f1-9590-279dfca4aef9` | `src/features/workflows/**`, workflow routes/settings, builder, admission, execution, run controls and its worker behavior. |
| MAIL — `01a18868-3300-7dc2-b49d-c3bdb067fae7` | `src/features/email/**`, mail-specific connections/providers, inbox/composer, email settings and email/Gmail/mail-connection adapters. |
| Privacy — `01a19263-11f1-7e30-adfb-e418eb02876e` | `src/features/privacy/**`, Privacy settings/requests, discovery/export/storage/lifecycle policies, its tests/UI and evidence-backed module classifications. |
| Agency — `01a192a3-dba9-7a52-80b6-43f384542fe6` | `src/features/agency-projects/**`, its private helpers, tests, future persistence adapters/routes and UI. |
| Integrations — `01a19217-d257-7813-88e0-cf41cb36d93a` | `src/features/integrations/**`, `src/features/connections/**`, generic connected-app/provider-directory/Slack surfaces, integration adapters and MCP/app-platform work. |
| Settings / integrator | Shared settings navigation, shell/UI conventions, regional preferences and cross-module integration. |

Use the existing workspaces and preserve unrelated changes. A newer main commit does not suspend independent development or force a whole-checkout rebase. The integrator reconciles the specific increment against latest main at landing. No new branches, clones or worktrees are needed. Only the integrator stages, commits and pushes canonical main.

## Shared contracts

Contact the integrator once when changing an actual shared interface. Continue private implementation against the agreed/current contract while that review happens. A shared filename alone is not a reason for a chain of approvals; additive module registration can be included in the integration note and reconciled at landing.

- Authentication/permissions: retain server-derived actors, session freshness, ownership/admin distinctions and current visibility and mutation authority. Changes affecting another consumer need an agreed contract.
- Activities: Calendar owns the service, while Sales queues, Workflow actions and MAIL follow-ups consume it. Completion/replay, CRM parent links, civil dates versus instants, reminders and deal/activity recomputation are shared contracts. `E_ACTIVITY_008` keeps canonical `COMPLETE_INPUT_INVALID` meaning; it must not be reused for a Calendar conflict.
- MAIL/Integrations: keep provider capability/status DTOs, mailbox ownership, reconnect, credential and send authority compatible.
- Events/runtime: retain current event provenance, notification admission/durable dispatch and job/worker registration contracts. An event-envelope or dispatch change gets one integration review; private implementation/tests need no separate file grants.
- Privacy classifications: use actual behavior/evidence from the affected module; do not mark storage, provider or installed-database support complete from a registry edit.
- Data/migrations: preserve canonical 0000–0097 and existing receipts. Reserve a migration number in the single queue before authoring a new canonical migration. The integrator reconciles final journal/snapshots at landing. Historical branch numbers/snapshots are not overlaid onto main.

The initial reservations are in WARPDRIVE-QUEUE.md. A reservation prevents a number collision; it does not approve an unspecified schema change.

## Standing focused-check limits

These checks are self-serve in the owner's existing private workspace, with one owned invocation at a time per chat:

- Formatting/Biome and focused unit/component tests: up to120 seconds total per invocation, one test worker.
- A genuinely module-only type/lint check with an observed small working set can use the focused lane. The declared whole-project typegen/TSC pipeline and type-aware ESLint construct a whole application program and use the heavy queue, up to180 seconds for a combined compiler phase. Actual profiling reached about6GiB, so these phases are serialized even at normal pressure. Use the declared commands; do not substitute bare TSC for required generation.
- Small source/tooling contract checks without DB/browser/build/service activity: up to 60 seconds total per invocation.

Use package-pinned Bun 1.4.4 and the declared lockfile/configuration. Use test/synthetic environment isolation and suppress automatic private dotenv loading. Normal ignored message declarations, next-env, type output and incremental metadata in the owner's workspace are included in ownership; they need no enumerated per-file permission. Preserve tracked source/configuration except the intended module edits. Do not install into a borrowed/shared dependency target; private dependency installation uses the heavy queue.

Before starting, require at least8GiB disk available. At normal memory pressure(level1), require at least20% reported available memory and keep owned aggregate RSS below8GiB. If resources deteriorate, stop/pause only the owned check and report the resource blocker. These are standing limits, not a fresh approval on each invocation.

Warning-mode lane: a sustained level2 signal with ample reported headroom must not stop every small check. With at least40% reported available memory, owners may self-serve formatting and small single-worker container-free tests for up to60seconds, keeping owned RSS below1.5GiB. Whole-project compiler phases stay serialized in the heavy queue. The integrator may allocate one small cached-PostgreSQL/native job with expected owned RSS below2GiB and no browser/build/install/pulls. In this lane, observe resources and stop owned work if available memory drops below30%, pressure becomes critical(level4), or ownership/RSS is uncertain. Report warning-mode execution as such; do not claim normal-pressure conformance or an unmeasured peak. Browser/build/install jobs continue to require level1. Missing/unparseable metrics, critical pressure or disk below8GiB mean no new run. Return automatically to normal focused limits once level1 returns; whole-project compilers remain serialized.

Use normal configured commands and tool-owned execution sessions with a finite deadline. Do not create a new generic process controller or guard qualification project to obtain a test slot. Observe terminal cleanup; report an exceeded/uncertain envelope honestly. Preserve protected services, data, unrelated processes and prior evidence.

After a meaningful edit, rerun the relevant failing/affected checks. Do not repeat already-green unchanged database suites merely because a separate static command was wrong. Whole-repository checks required for integration and exact-head CI remain the integrator's responsibility.

## One heavy-job queue

The integrator alone maintains WARPDRIVE-QUEUE.md. Database/Testcontainers jobs, browser/playback jobs, whole-project compiler phases, app/worker builds, dependency installation and service/runtime campaigns use this queue. One heavy local job runs at a time. Focused checks above do not need a queue slot; a heavy job may pause concurrent focused checks if resources require it.

The board has one current heavy authorization ID/owner. Read it immediately before launch; a policy/resource update or a queued/reserved note is not a start notice. Each start is one-use, including a zero-test setup failure. The integrator does not reassign an outstanding authorization until its owner returns actual terminal cleanup or an explicit unstarted release. This avoids crossed chat messages without per-file grants or another controller.

Request a slot with one short note: workspace, concrete command/test selection, expected duration and owned resources. No per-file grant chain or bespoke manifest is required for ordinary module code. Existing useful frozen plans can be reused. Default ceilings are five minutes for a single isolated database or browser job and fifteen minutes for a build/install; the slot can state a smaller or justified larger finite ceiling. Include cleanup in the ceiling. Start/terminal reports go directly to the integrator.

Use only the job's isolated resources and clean only those resources. Existing provider, credential, cloud, production and publication authorization boundaries remain unchanged. No global pruning or removal of another workspace's data/dependencies/profiles.

For this Mac's existing Colima daemon, Testcontainers jobs use job-local `DOCKER_HOST=unix:///Users/ali/.colima/warpdrive/docker.sock` and `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`. The first is the Mac API endpoint; the second is the daemon-side socket used by helpers such as Ryuk. Do not change global context or start another VM. Take a fresh baseline instead of assuming a fixed container count; the separate README preview database is also protected when present.

## Main and delivery

The integrator takes completed increments sequentially, applies only the intended changes, resolves real shared conflicts, runs required integration checks and commits/pushes main. Main CI controls publication and the Delivered label. A failed CI run holds that publication; independent module implementation and focused testing continue in private workspaces.

Each handoff needs the increment/diff, actual checks/results and a short shared-contract/data-impact note. Preserve failures and unfinished work. Prepared code, packets, test definitions, fixtures and infrastructure remain partial progress until exercised and integrated. Earlier successful evidence stays tied to its actual source cut.

For every integrated production-source change, the integrator checks the privacy source-review bindings and actual discovered boundaries, updates only the reviewed companions, runs registry regressions and regenerates the inventory report from the unmodified CLI with empty missing/invalid lists. This maintenance does not widen lifecycle capability or installed acceptance and does not create another module permission loop.

Each feature chat advances one small complete user journey at a time while retaining its entire roadmap. The first release milestone is:

1. Create a deal and manage it through stages with correct persistence, permissions and feedback.
2. Schedule an event and receive a reliable reminder, including failure/retry behavior.
3. Connect a mailbox and manage messages reliably, including clear failures and draft/read-state preservation.
4. Run one useful follow-up automation with durable execution and truthful status.

Agency and Privacy continue bounded deliverables alongside this milestone. Supporting core increments can land without being described as completed user journeys.

## Reporting

Use only these four fields in normal progress reports:

- Delivered: working in main with required checks passed; name the actual usable outcome.
- In progress: one concrete user-facing outcome.
- Blocked: exact dependency and its owner, or none.
- Next delivery: next usable increment and remaining work.

Report meaningful changes, delivery, actual blockers or a heavy-job start/finish. Do not send repeated unchanged acknowledgments, status pings or routine file-permission requests. Keep technical receipts in the workspace and link them when useful. No combined roadmap completion percentage is implied.

## Nested Bun environment guard

For future validation commands use job-local `BUN_OPTIONS=--no-env-file` inside the clean environment as well as direct `--no-env-file`, Vite `envDir:false`, and absence checks for Next automatic dotenv files. Agency verified on pinned Bun1.4.4 that a parent `--no-env-file run script` does not suppress dotenv in nested Bun commands; `BUN_CONFIG_NO_ENV_FILE=1` does not supply that guarantee. No global runtime/package setting changes. Earlier runs with actual absence evidence remain valid; no blanket retest. Active frozen jobs retain their precise evidence; unstarted operational env amendments preserve source scope.

## Integrator qualification corrections, 2 November 2026

The first duration-wait publication exposed two gaps in the integrator's local selection. Include every changed supported file type in the configured formatter, including Markdown. For additive schema changes, exercise relevant existing populated-upgrade compatibility tests as well as the new migration case; whole-row snapshots of affected tables must preserve all legacy fields and separately assert the new column's intended default. Keep ledger, foreign-key, history and rerun oracles intact. These are integration checks, not new per-file permission requests for module owners.

## GitHub continuation base after the safe stop

Use https://github.com/KhademOHAli1/warpdrive/issues/80#restart-index to choose the exact work item before resuming. Keep live progress, source/integrated/accepted/released evidence, blockers and one next action on that canonical issue after each increment. Historical imported CSV/JSON statuses remain frozen observations. The tracking update itself does not resume feature chats or heavy allocations.

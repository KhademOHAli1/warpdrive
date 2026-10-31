# Builder interaction acceptance record

Date: 31 October 2026. Continuation branch: `codex/workflow-builder-ux`, based on
`d0c83e8`, with fork main `a1a8f6d` merged without conflicts. This is an early-access manual-workflow milestone, not completion of R1.

## Research and implementation tasks

- [x] Revisit Mobbin Attio contextual step creation and branch-specific next steps, M02/M03.
- [x] Preserve the existing CRM shell, fonts, semantic tokens, shared dialogs and form controls.
- [x] Apply connection rules during pointer targeting and after drop.
- [x] Enlarge handle hit areas, retain small visible ports, and provide valid/invalid feedback.
- [x] Accept a destination card drop and preserve original connections on rejected changes.
- [x] Add a searchable picker from a free output, its form control, or an empty-canvas drop.
- [x] Create and connect a step atomically, using only its path for default mappings.
- [x] Add bounded graph undo/redo; commit a completed node drag as one edit.
- [x] Summarize configuration on nodes and reveal steps from navigation/validation.
- [x] Add authorized historical graph and step-result inspection, excluding CRM outputs.
- [x] Translate new flows into English, Farsi and German.
- [x] Run the recorded pointer, language, mobile and actual-execution scenarios below; attach captures.
- [x] Keep focused-dialog close controls visible while long mobile content scrolls.
- [x] Record local checks and prepare the isolated continuation for review.

## Isolation and fixtures

The continuation uses its own checkout, database and workflow-only worker. The earlier
preview and its settings audit are untouched. The hostname `workflow-ux.localhost:3117`
isolates cookies from the other local previews. All CRM data is synthetic. Test-only auth
assurance permits publication in this disposable database; this is not evidence of real
MFA/provider onboarding. No provider messages or production deployment are involved.

## Browser and runtime acceptance matrix

| Scenario | Result / evidence |
| --- | --- |
| Free output dragged to empty canvas | Observed in Chrome: contextual picker identifies source and automatically connects the selected condition. |
| Search and independent branch creation | English filtering, no-result recovery, and both branch-specific creations observed. Six-node/five-edge graph saved. |
| Card/port drawing, occupied inputs, cancelled moves | See detailed results below. |
| Undo/redo, complete-drag history, deletion restoration | Observed atomic insertion undo/redo, rejected/cancelled connection preservation, card-drop reconnection undo, and one-undo restoration of a node drag. |
| Save/reload and locale switching preserve graph/content | EN to FA to DE to FA retained the six-node graph, a Persian unsaved workflow name, Persian task text and German custom content. Saves confirmed in PostgreSQL. Final cold reload after integration remains pending. |
| Farsi RTL, German, mobile, light/dark | Farsi/German desktop and 390x844 layouts inspected; page width stayed 390px with no horizontal document overflow. Dark theme captured. Final light-theme inspection remains pending because browser automation timed out. |
| Simulation keeps no task changes | Completed via Farsi UI and real worker; zero retained activities afterwards. |
| Live matching/non-matching paths create intended tasks | Both real runs completed via Farsi/German UI. Open deal: common review + Persian follow-up. Won fixture: common review + German result task. Four total tasks, no duplicate or wrong-branch task. |
| Historical graph stays pinned after draft changes | PostgreSQL regression and browser inspection pass: draft changed to notEquals while historical version 1 still displayed equals. |

## Qualification

Before merging the new main commits, the full unit run passed **5,771 tests across 939 files**.
The separate new shortcut regression also passed. Current workflow tests pass **59 tests
across 22 files**, and **22 real PostgreSQL tests across eight files**. Root typecheck and
full lint passed (existing 11 cookie warnings and 9 style infos). After integrating main `a1a8f6d`, the application production build, server entrypoint
bundles, documentation build and typecheck pass. The combined workflow/auth-UI/locale
unit lane passes **110 tests across 37 files**. Current workflow ESLint and the i18n
audit pass with zero new translation findings. Full integrated CI is tracked on GitHub;
the earlier full local unit count is not re-labeled as a post-merge run.

The browser captured six synthetic screenshots below. A final browser request timed out
while checking run-detail scrolling. No extension update or browser restart was attempted.
The editor close control was verified in the viewport after scrolling (top 17px, bottom
57px at 390x844). Final light-theme inspection, run-detail close scrolling, cold reload and
viewport cleanup must be reconfirmed when browser automation is available. This limitation
is retained explicitly instead of treating screenshots as complete accessibility/device proof.

The temporary notEquals draft and won deal fixture were restored in the isolated database
after the browser interruption. Published version 1 remains active with the original six-node
graph; its simulation and two live histories and four synthetic tasks are retained.

## Captures

- [Farsi focused mobile graph](../images/workflows/interaction-review/editor-fa-mobile.jpg)
- [Farsi mobile condition controls after scrolling](../images/workflows/interaction-review/fields-fa-mobile.jpg)
- [German mobile action picker](../images/workflows/interaction-review/picker-de-mobile.jpg)
- [Farsi simulation trace](../images/workflows/interaction-review/run-fa.jpg)
- [German non-matching live trace](../images/workflows/interaction-review/run-de.jpg)
- [German mobile run details](../images/workflows/interaction-review/run-de-mobile.jpg)

## Remaining limits

Only manual start, visible-deal reads, exclusive text/boolean conditions and undated
self-assigned follow-up tasks execute. Undo is local to the browser session, up to 50 edits;
it does not undo tasks already created by a run. Simulation still requires a published
version. Historical inspection exposes configuration and completion metadata, not CRM
payloads, attempts, retries or compensation. Automatic triggers, richer actions, grouped
conditions, durable waits, provider integrations, retention/quotas and full assistive-
technology/touch-device qualification remain separate work.

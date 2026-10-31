# Builder interaction acceptance record

Date: 31 October 2026. Continuation branch: `codex/workflow-builder-ux`, based on
`d0c83e8`. This is an early-access manual-workflow milestone, not completion of R1.

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
- [ ] Complete the browser and runtime acceptance matrix below and attach captures.
- [ ] Record final checks and publish the isolated continuation branch for review.

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
| Search and independent branch creation | Observed English action filtering and creation on the matching branch. Final graph verification pending. |
| Card/port drawing, occupied inputs, cancelled moves | Pending final browser pass. |
| Undo/redo, complete-drag history, deletion restoration | Domain/UI tests pass; final browser pass pending. |
| Save/reload and locale switching preserve graph/content | Pending final browser pass. |
| Farsi RTL, German, mobile, light/dark | Pending final browser pass. |
| Simulation keeps no task changes | Baseline runtime tests pass; new browser run pending. |
| Live matching/non-matching paths create intended tasks | Baseline branch tests pass; new browser runs pending. |
| Historical graph stays pinned after draft changes | New PostgreSQL regression passes; browser inspection pending. |

## Qualification

Current targeted checks: 58 workflow unit tests across 21 files and 22 real PostgreSQL
integration tests across eight files pass. Final full-suite/build/lint/documentation results
will be recorded after the browser pass. Earlier CI evidence remains in `status.md` and
`ui-review.md` and is explicitly baseline evidence.

## Remaining limits

Only manual start, visible-deal reads, exclusive text/boolean conditions and undated
self-assigned follow-up tasks execute. Undo is local to the browser session, up to 50 edits;
it does not undo tasks already created by a run. Simulation still requires a published
version. Historical inspection exposes configuration and completion metadata, not CRM
payloads, attempts, retries or compensation. Automatic triggers, richer actions, grouped
conditions, durable waits, provider integrations, retention/quotas and full assistive-
technology/touch-device qualification remain separate work.

# Visual workflows: UX flows and design references

Research date: 31 October 2026. Status: reference research and proposed interaction specification. Current implementation evidence is recorded in [status.md](status.md).

## Recommendation

Use Attio's CRM-oriented workflow editor as the main interaction reference and Zapier's setup/configure/test progression as the secondary reference for connected actions. Render the resulting experience with Warpdrive's existing shell, semantic color tokens, local Inter/Vazirmatn fonts, borders, typography, controls, and light/dark behavior.

Default to a top-to-bottom workflow, a contextual properties inspector, a searchable action/variable picker, visible draft/active state, and run inspection on the saved graph. An ordered-step view and expandable focused editor provide a usable path without canvas dragging. Keep advanced capabilities discoverable in relevant places rather than opening every configuration surface at once.

The references were visited in the user's signed-in Mobbin website in Chrome. The available plugin search returned no Mobbin connector. Research involved opening captured flows and visually inspecting relevant frames; it did not connect provider accounts, run the referenced products, publish automations, or save collections in Mobbin.

## Verified Mobbin reference register

Frame counts are the captured sequence lengths shown by Mobbin. Inspection notes specify the frames used; a capture is visual evidence of a UI pattern, not verification of its backend behavior or current live product. Some flows use different generations of the source product's interface. No third-party screenshots/assets are bundled with Warpdrive.

| Ref | Exact flow / captured length                                                                                         | Visually observed                                                                                                                                                                                                                                                                                                                               | Warpdrive adaptation / tasks                                                                                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M01 | [Attio: Creating a workflow](https://mobbin.com/flows/2f4ee290-153e-4f02-b331-676b6a1b64f4), 4 screens               | Empty library and first action; prompt-led creation with example suggestions and Start from scratch; a generated record-action → delay → task graph with explanation panel and unpublished-changes banner. Beginning and final frames inspected.                                                                                                | Adopt clear entry, manual starting path, compact node summaries, and draft feedback. Provide templates and deterministic manual creation in R1; AI creation is a later proposal. WF-016–019, WF-026.                                                      |
| M02 | [Attio: Adding a filter](https://mobbin.com/flows/b70ccea5-109c-4b46-b964-9510aa9e0a91), 10 screens                  | Selected trigger and contextual inspector; add-next placeholder; searchable grouped block picker with Filter/If-else/Switch; condition field picker exposing prior trigger record/actor/time; country selection; final filter → task configuration. Frames 1–3, 5, 7, and 9–10 inspected, including neighboring frames visible in the carousel. | Keep one selected step, searchable action categories, field/operator/value conditions, and typed source navigation. Use readable source chips and preview values. WF-017–022.                                                                             |
| M03 | [Attio: Adding a condition](https://mobbin.com/flows/aa296392-5e4b-463c-babd-879bb59b89ff), 9 screens                | Task configuration with variable controls; search-record settings with object/limit; if/else node with labeled true/false paths and separate next-step targets. Frames 1, 5, and 8–9 inspected.                                                                                                                                                 | Use named branch outcomes and an explicit default route. Distinguish an exclusive condition from parallel execution. Explain invalid or unavailable source references. WF-020–022, WF-036.                                                                |
| M04 | [Attio: Publishing a workflow](https://mobbin.com/flows/fff59bcf-3457-4612-92ff-c31d52e7d91d), 2 screens             | Unpublished-changes banner and Publish changes control on the editor; following frame removes the unpublished banner. Both captured frames inspected, second partially within carousel.                                                                                                                                                         | Persistent draft/active distinction; explicit publication review with effect, identity, and connection summary; frozen version. Do not treat save as activation. WF-010, WF-026.                                                                          |
| M05 | [Attio: Resolving an issue](https://mobbin.com/flows/b870d94b-8097-4bd8-880a-306e4b4cb240), 6 screens                | Workflow checklist lists unconfigured steps; selecting a problem opens that step's inspector; completing the record-search condition removes that issue while a separate if/else issue remains. Frames 1–3 and 5–6 inspected.                                                                                                                   | Validation panel links directly to node and field, tracks outstanding issues, and remains useful after partial correction. Do not claim this capture proves all issues were resolved. WF-019, WF-020, WF-026.                                             |
| M06 | [Attio: Workflow runs detail](https://mobbin.com/flows/1ce88003-a672-4fd5-8208-cfc2aca49201), 4 screens              | Editor/Runs switch; empty run history; overview counts/runtime; selectable run list; completed graph path and run tooltip. All four frames inspected across beginning/end views.                                                                                                                                                                | Run list plus selected graph and step inspector. Show waiting/retrying/needs-review, duration, failure causes, and redacted data; retain historical version. Billing credits shown in the reference are not a proposed Warpdrive requirement. WF-027–028. |
| M07 | [Attio: Updating a workflow timezone](https://mobbin.com/flows/69189407-63ab-4ee4-8518-8bbf1b8defac), 5 screens      | Workflow Settings destination, timezone setting with explanatory text, searchable IANA timezone selection with GMT labels, and failure-notification setting. Frames 1–4 inspected; final frame partially visible.                                                                                                                               | Add workflow timezone, calendar system, business calendar, and next-occurrence preview. Calendar selection and Iranian recurrence are our additions, not shown in this capture. WF-030–031.                                                               |
| M08 | [Attio: Filtering and sorting automations](https://mobbin.com/flows/c2aa3131-29ef-4ffc-8999-824194e5829d), 7 screens | Library table with name, runs, status, creator, last publication; New workflow, sort/filter controls; sort menu with publication/name/direction. Opening two frames inspected.                                                                                                                                                                  | Searchable library using existing CRM table conventions; status and owner filters; recent failures and saved view preferences. Remaining filter-dialog details are not verified by this sample. WF-016, WF-027.                                           |
| M09 | [Zapier: Testing a connection](https://mobbin.com/flows/fcd35efa-2b51-4de9-8999-e1ba024d075c), 3 screens             | Node inspector with Setup/Configure/Test progression; selected provider account with menu for test/reconnect/rename; inline testing indicator followed by account-working confirmation. All three frames inspected.                                                                                                                             | Make selected account and readiness explicit. Connection check is distinct from an action test; successful connection does not prove send/write permissions or a successful workflow run. WF-019, WF-024–025, WF-033.                                     |
| M10 | [Zapier: Switching to focus view](https://mobbin.com/flows/6b36f0db-ca65-4222-b98a-4fdc086acd03), 3 screens          | A step inspector's expand affordance opens a larger centered editor while preserving step context and setup/configure/test stages. All three frames inspected.                                                                                                                                                                                  | Expand complex field mapping into focused editing; restore selection and keyboard focus on return. Our ordered-step accessibility view is an additional design requirement, not established by this capture. WF-017, WF-019–020, WF-040.                  |

Supporting collection links: [Attio captured web flows](https://mobbin.com/apps/attio-web-f8618f57-3608-4752-9643-94b510d99b43/892acdf2-7578-4df0-aea7-1ffed421dae6/flows), [Zapier captured web flows](https://mobbin.com/apps/zapier-web-5032f9ec-3d58-43e5-8ddd-707f0fe5d72f/51901f8b-33ed-487a-92cd-63e4904e392e/flows).

## Existing Warpdrive design constraints

Reviewed `src/app/globals.css`, `docs/auth-ui-design.md`, and the existing synthetic German settings capture at `docs/images/auth/security-de.png` in the current local checkout. That capture is a working-state reference, not proof that the main branch or deployed UI matches it.

- Retain the product's global sidebar and current navigation behavior; add an Automations destination through that navigation system.
- Reuse the configured interface fonts: Inter for the existing Latin interface and Vazirmatn for Farsi.
- Use existing semantic surface, border, foreground, muted, primary/action, success, warning, and destructive tokens. Category accents must remain secondary and must work in both themes.
- Keep the existing compact CRM density while giving labels, mapped values, and error explanations adequate space. Avoid squeezing German labels into fixed-height rows.
- Node cards show icon, editable human name, action type, short configuration summary, and status. Full forms live in the inspector.
- Reserve the strongest action emphasis for the current decision. Show save progress as status; distinguish Test from Publish and the optional Live test.
- Keep the editor inside the application shell. A deliberate focus mode may temporarily expand the editor and must offer a clear return path.

## Information architecture and screen inventory

Suggested routes are proposals to reconcile with the app router during implementation:

| ID    | Surface                       | Main content and actions                                                                                                     | Required alternate states                                                                         |
| ----- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| UX-01 | `/automations` library        | Workflow list, filters, owner/status/last run, create and templates, per-row contextual actions                              | First use, no matching results, loading, denied, archived, paused for invalid owner/connection    |
| UX-02 | New workflow/template chooser | Name, purpose, template or blank, permission-aware object/trigger choices                                                    | Duplicate name guidance, unavailable template prerequisites, create failure                       |
| UX-03 | `/automations/[id]` editor    | Header, Editor/Runs/Versions/Settings destinations, draft status, canvas/steps switch, Test, publication action              | Saving, saved, offline/save failure, revision conflict, read-only version, unpublished changes    |
| UX-04 | Trigger/action picker         | Search, CRM/logic/time/communication/integration categories, description, readiness and input hints                          | No results, denied action, provider not configured, incompatible action                           |
| UX-05 | Step inspector                | Selected step summary, Setup/Configure/Test where useful, required fields first, advanced section, expand, contextual delete | Invalid mapping, required input, missing record, revoked connection, stale schema                 |
| UX-06 | Variable picker               | Searchable available upstream outputs, type/source/value preview, null/empty behavior                                        | No sample available, inaccessible field, type mismatch, deleted source step                       |
| UX-07 | Condition editor              | Field → operator → value rows, AND/OR grouping, plain-language summary, explicit branch destinations                         | Missing value, incompatible type, incomplete branch, ambiguous/null case                          |
| UX-08 | Test drawer/focus view        | Trigger input selector, simulation indicator, effect preview, test execution and step results                                | No authorized sample, invalid graph, simulated external action, action failure, cancelled test    |
| UX-09 | Publication review            | Trigger, execution identity, changes, access/connection needs, effects, warnings, version and activation                     | Blocking errors linking to fields, concurrent draft update, stale test/version, missing authority |
| UX-10 | Runs and selected execution   | Status/date filters, duration, selected pinned graph, executed branch, step data/attempts/timing                             | No runs, queued, running, waiting, failed, needs-review, cancelled, data expired/redacted         |
| UX-11 | Version history               | Version/author/date/change summary, read-only view, compare, use as draft                                                    | Unknown action version, restoring a version with missing connection, competing draft              |
| UX-12 | Workflow settings             | Owner/access, failure alerts, quotas, timezone/calendar/schedule, archive/deactivate                                         | Owner inactive, permission changed, schedule invalid, connection revoked                          |
| UX-13 | Connections and prerequisites | Authorized account, scopes/capabilities, availability, test, reconnect, dependencies                                         | Expired/revoked, incomplete consent, insufficient write scope, test unavailable                   |
| UX-14 | Approvals/inbox, R3           | Awaiting decisions, record context, requested action, approve/reject/input, expiry                                           | Already resolved, expired, unauthorized, record access lost, cancelled                            |

## Proposed editor composition

```text
Existing global shell and sidebar
┌───────────────────────────────────────────────────────────────────────────┐
│ Workflow name  ·  Draft changes saved             Test   Review & publish │
│ Editor   Runs   Versions   Settings                                       │
├─────────────────────────────────────────────┬─────────────────────────────┤
│ Canvas / ordered steps                      │ Selected step               │
│                                             │ Setup · Configure · Test    │
│            [Deal stage changed]             │                             │
│                     ↓                       │ Connected account / object  │
│            [Check conditions]               │ Required fields             │
│              ↙           ↘                  │ Mapped data chips           │
│        [Create task]    [Finish]             │ Advanced options            │
│              ↓                              │                             │
│        [+ Add next step]                    │ Input/output preview        │
│                                             │ Inline issues               │
│ Zoom · Fit · Layout                         │                             │
├─────────────────────────────────────────────┴─────────────────────────────┤
│ Contextual test/results panel, shown when needed                         │
└───────────────────────────────────────────────────────────────────────────┘
```

The sketch specifies relationships, not final pixels. Suggested desktop node width is approximately 240–300 px and inspector width approximately 360–440 px, constrained by available space and reviewed with actual Farsi/German text. Use logical CSS properties so the inspector moves to the logical end in RTL. Below a comfortable dual-pane width, show selected step or ordered steps with an explicit back path; do not shrink a desktop graph into illegible controls.

## End-to-end interaction journeys

### J1. Create and configure

1. Open Automations; choose New workflow or a template.
2. Name the workflow and select a trigger/object. Explain whether it runs manually, on committed CRM changes, on a schedule, or by webhook.
3. The trigger node appears selected; its inspector asks only for relevant setup.
4. Add the next step from the connector or keyboard command. Search actions by human purpose and provider.
5. Configure required fields and map typed values from upstream steps. A sample preview shows the record/source and distinguishes a value from a variable reference.
6. Add a condition. Label each outcome and show what happens when a value is absent.
7. Save the draft automatically with visible saving/saved/failure state. A revision conflict offers reload/compare/copy of changes without silent replacement.

References: M01–M03, M09–M10. Tasks: WF-016–022, WF-039–040.

### J2. Test and fix

1. Select Test and choose sample trigger data or a record the user can access.
2. Default to simulation. List effects that will be simulated and unsupported simulations explicitly; do not silently skip an action and mark the run successful.
3. Show the path taken and individual inputs, outputs, warnings, and failures.
4. Selecting a problem focuses the affected node and invalid field. Correct it in context, then rerun the affected test with current inputs.
5. A Live test is a separate authorized action with a summary of writes/messages and recipient/account. A connection check only validates the connection; it is not a send test.
6. Results retain the tested draft revision. Any subsequent semantic edit invalidates the test's claim to cover the current draft.

References: M05, M09–M10; simulated execution and revision binding are proposed requirements. Tasks: WF-014, WF-025–026.

### J3. Publish or update

1. Choose Review & publish from the saved draft.
2. Review when it will run, who it acts as, records/mailboxes it can affect, external connections, and the changes from the active version.
3. Resolve blocking issues from a linked checklist. Non-blocking warnings explain their practical consequences.
4. Publish and activate the validated revision atomically; show active version and activation result. Save alone leaves a draft.
5. Editing an active workflow creates a draft while the published version remains explicit. Existing runs remain pinned to their original version.
6. Deactivation stops new admissions. Cancellation of existing runs is a separate, clearly scoped operation.

References: M04–M05; immutable version and cancellation semantics are engine requirements. Tasks: WF-010, WF-026, WF-028.

### J4. Inspect and recover a run

1. Open Runs, filter status/time/trigger, and select an execution.
2. Display its historical graph, trigger, identity, version, timestamps, actual route, and current state.
3. Select a step to inspect redacted inputs/outputs, attempt history, external effect result, and a useful next action.
4. For a delay or approval, show what it is waiting for and when it resumes/expires.
5. For failure, offer retry only where the effect protocol makes that safe. An uncertain provider result enters reconciliation/needs-review.
6. Cancellation prevents further eligible work; completed external effects remain listed. Full rerun uses a new execution and explains potentially repeated effects.

Reference: M06 for layout; reliability behavior is proposed. Tasks: WF-013–014, WF-027–028, WF-035.

### J5. Configure Iranian calendar scheduling

1. Select calendar system and workflow timezone independently from interface language.
2. Choose a readable recurrence such as the first day of every Iranian month at 09:00 in Asia/Tehran.
3. Select policies for invalid dates, missed occurrences, and optionally business days/holidays.
4. Preview the next five actual occurrences with calendar-aware dates, timezone, and unambiguous instants where needed.
5. Review changes before activation; clearly state how edits affect existing waiting runs versus newly scheduled runs.

Reference: M07 for searchable timezone/settings layout. Iranian recurrence, business calendars, and policy previews are Warpdrive requirements, not observed Mobbin functionality. Tasks: WF-030–031.

### J6. Connect an external action

1. Choose provider and action; show the capabilities and permissions required.
2. Select an existing authorized connection or start the provider consent journey when implemented.
3. Check the connection and show checking/success/reconnect/insufficient-scope states inline.
4. Configure inputs, map typed values, and test with explicit effect handling.
5. Show connection dependencies and the effect of revocation on published workflows and waiting runs.

Reference: M09 for selected-account menu and check feedback. Provider consent, scope validation, secret handling, and dependent-run behavior need separate implementation evidence. Tasks: WF-024–025, WF-033–034.

## Language and direction specification

Initial proposed product vocabulary; refine against existing translation catalogs and native-language review during WF-003/WF-039. Avoid translating internal identifiers or user-authored workflow names.

| Concept                 | Farsi               | German                         |
| ----------------------- | ------------------- | ------------------------------ |
| Automations, navigation | خودکارسازی          | Automatisierungen              |
| Workflow / workflows    | گردش‌کار / گردش‌کارها | Workflow / Workflows           |
| New workflow            | گردش‌کار جدید        | Neuer Workflow                 |
| Trigger, field label    | شرط شروع            | Auslöser                       |
| Step                    | مرحله               | Schritt                        |
| Action                  | اقدام               | Aktion                         |
| Condition               | شرط                 | Bedingung                      |
| Draft                   | پیش‌نویس             | Entwurf                        |
| Unpublished changes     | تغییرات منتشرنشده   | Unveröffentlichte Änderungen   |
| Simulation              | شبیه‌سازی            | Simulation                     |
| Test run                | اجرای آزمایشی       | Testlauf                       |
| Publish and activate    | انتشار و فعال‌سازی   | Veröffentlichen und aktivieren |
| Run history             | سابقهٔ اجراها        | Ausführungsverlauf             |
| Waiting                 | در انتظار           | Wartet                         |
| Retry                   | تلاش دوباره          | Erneut versuchen               |
| Needs review            | نیازمند بررسی       | Prüfung erforderlich           |
| Timezone                | منطقهٔ زمانی         | Zeitzone                       |
| Iranian calendar        | تقویم هجری شمسی     | Iranischer Kalender            |

Use contextual descriptions, for example Farsi «با تغییر مرحلهٔ معامله، این گردش‌کار اجرا می‌شود.» and German «Dieser Workflow startet, wenn sich die Phase eines Deals ändert.» A draft can be published but inactive, so Draft, Published, and Active must remain separate concepts even if the first release combines publication and activation in one explicit action.

- Farsi panels and reading order use RTL. Source expressions, URLs, email addresses, IDs, and code fragments use isolated LTR spans.
- Keep graph flow top-to-bottom in both directions; branch placement is layout and never changes branch meaning. Name outcomes, do not rely on left/right.
- Respect account numbering/calendar/timezone preferences in display. The workflow's scheduling timezone is an explicit execution setting and may differ from the viewer's.
- German labels may wrap or expand the inspector; no clipped action names or button text.
- Every control remains accessible with keyboard and screen reader; zoom and drag are convenience features, not the only way to operate the builder.

## Design acceptance before application implementation

Produce reviewable prototypes for UX-01, UX-03, UX-05/06, UX-08/09, and UX-10 with realistic synthetic workflow data, Farsi RTL and German LTR, and light/dark variants. Include a meaningful validation failure, waiting run, revoked connection, and publication summary. Show the layouts against the current application shell and compare them to M02/M05/M06/M09.

Implementation is approved. The [initial working UI review](ui-review.md) records Farsi,
German, and narrow-screen captures for the manual-flow milestone. The remaining prototype
states and full WF-005/040 acceptance gates are still open. This specification and the
[implementation plan](implementation-plan.md) remain the design contract; progress is
recorded in [status.md](status.md).

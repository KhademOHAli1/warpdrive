---
title: Visual workflows
description: "Connect nodes, configure conditional branches, simulate, publish, and run manual CRM processes."
---

# Visual workflows

**Early access:** create a process by connecting a manual start, deal-read nodes, conditions,
and follow-up tasks. Automatic CRM triggers, waits, email, and provider integrations remain
in development. Existing email scheduling and reminders keep their existing workers.

## Start a workflow

Open **Workflows** in the sidebar and choose **New workflow**. Select a follow-up template
or a blank canvas with just the manual start, then give the workflow a name.

**Add node** offers **Read deal**, **Create task**, and **Condition**. Each new node starts
unconnected when added from the toolbar. To extend a specific path, use **+ Next step**
on a node or **Add a new connected step** in its Connections panel. Conditions offer an
independent add control for each outcome. The searchable picker identifies the source and
connects the chosen step in one edit.

## Connect the process

Drag an output dot to another node's input dot, or release it on the destination card.
Ports have a larger transparent hit area and snap radius. A valid port highlights green;
an unavailable port highlights red. Manual starts have no input. Ordinary
nodes have one next-step output; conditions have separate **Matches** and **Does not match**
outputs. Both condition outputs need a destination before publication.

Select a connection to change its source, output, or target in the settings panel. You can
also drag its endpoint onto another node. **Remove connection** or Delete removes the
selected edge. Drawing from an occupied output moves its existing connection; a rejected
drop or release on empty space preserves the original. Inputs already used by another path
cannot be stolen. Dragging a free output onto empty canvas opens the connected-step picker.
Closing that picker leaves the graph unchanged.

![German action picker on mobile](../../../docs/images/workflows/interaction-review/picker-de-mobile.jpg)

Removing a node removes its incident connections, leaving the remaining
process for you to reconnect explicitly.

Connections form a tree with one incoming path per node. Loops and joins are rejected.
Disconnected or incomplete drafts can be saved; publication requires a complete valid graph.

Drag nodes to position them. **Arrange nodes** lays out the connected branches and any
unconnected nodes. Pan, zoom, and fit controls are available. **Focus canvas** opens a larger
editing workspace; Escape returns to the workflow. Node positions are saved with the draft.

**Undo** and **Redo** restore graph edits, configuration, connections, and positions,
including a removed step's mappings. A completed drag is one undo operation. Up to 50 edits
are kept in this browser session; reload discards this undo history. Save does not clear it.
Use Command/Ctrl+Z and Command/Ctrl+Shift+Z inside the builder. Text fields keep their native
text-editing shortcuts. A new edit after undo discards the redo path.

The step selector and per-node **Connections** controls provide an alternative to drawing
connections. Select a node, then choose its next node for each output in the settings panel.
Selecting a step from the selector or issue list brings it into view at a readable scale.
Keyboard users can select nodes from the step selector; Delete/Backspace on a selected graph
node removes it. Editing text with Backspace does not remove graph nodes.

![Farsi mobile canvas with condition branches](../../../docs/images/workflows/interaction-review/editor-fa-mobile.jpg)

Captured 31 October 2026 using synthetic local records. The current application shell,
fonts, colors, and shared controls are retained.

## Configure nodes

**Read deal** takes a deal reference from a connected earlier step. Later steps can use its
available output fields. The mapping choices include only connected ancestors in the
current path. Breaking a required connection marks the mapping unavailable.

**Create task** takes a literal title or a text field from an earlier connected step, and
a deal reference from the manual start or a deal-read node. It creates an undated task
assigned to the person who starts the run. Other activity types, due dates, assignees,
and arbitrary record modifications are not configurable in this release.

**Condition** compares a text or boolean output from an earlier step. Supported comparisons
are equals, does not equal, has a value, and contains text. Comparisons do not coerce types;
contains is case-sensitive. Deal statuses and boolean values have translated choices while
the stored values stay language-neutral. Numeric/money comparisons, AND/OR groups, and
parallel joins remain later work. Only the selected condition branch executes.

Node cards summarize task titles, selected record sources, and condition comparisons.
A step can use its automatic localized title or a custom name. Automatic titles follow
language changes; custom names and task text remain exactly as entered.

## Save, publish, and simulate

**Save draft** preserves edits and positions. A conflicting save keeps your local draft and
reports the conflict instead of replacing a newer revision. Reloading or closing the page
with unsaved changes triggers the browser warning. Guarding every in-app route change is
still a tracked acceptance item; save before leaving through navigation.

**Publish** validates the complete graph and mappings, requires recent authentication
through Settings > Security, and activates an immutable version. Editing afterwards changes
only the draft. Existing runs retain their original published version.

Select **Simulate**, enter at least two characters to search for a visible deal, select it,
and confirm. Simulation uses the published version and canonical CRM validation, then rolls
back task changes. Run history is retained. Publication is currently required before simulation.

## Run and inspect

Select **Run workflow**, choose a deal, and review the confirmation. This creates real tasks
on the selected path. The background worker continues after the browser closes. Startup and
minutely reconciliation recover missed enqueues.

**Run history** shows mode, status, timestamps, completed-step count, and stable failure IDs.
Choose **View run** to inspect the immutable published graph used for that run. Completed
steps and their connected path appear in green; the step list distinguishes completed,
simulated, not-reached, and failed-cursor states. Selecting a step focuses it on the graph.
Later draft changes do not alter this historical view. Queued/running details update while open.

![Farsi simulation graph and step results](../../../docs/images/workflows/interaction-review/run-fa.jpg)

Raw CRM inputs/outputs are withheld because historical access may change. Detailed redacted
step payloads, attempt timing, and manual retry are later milestones.

**Cancel run** stops subsequent steps; already committed tasks remain. **Pause** prevents
new runs while previously admitted runs continue. Publishing reactivates a paused workflow.
The worker rechecks the initiating user's current permissions and deal visibility at every
step. Losing access or being deactivated stops the run.

## Permissions and languages

Capabilities are view, create, edit, publish, run, and cancel. Regular users need the
corresponding permission and ownership; administrators retain explicit authority. Publication
requires fresh authentication.

English, Farsi RTL, and German share the application's language system. Switch languages in
the editor without discarding edits. Editor messages, generated titles, mapping choices,
and branch labels update; custom content and connection semantics stay intact. The graph
keeps its coordinates while localized content and the surrounding panels follow RTL/LTR.

Run timestamps follow the account's calendar, timezone, and digit preferences, including
the Iranian calendar. Calendar display does not enable Iranian recurring schedules.

## Remaining delivery stages

The repository's `docs/workflows/` directory contains the approved 42-task plan, Mobbin
references, architecture, operations, and visual test ledger. This manual node builder is
one milestone within R1. CRM events, richer actions, grouped conditions, waits, notifications,
controlled email, operational limits, retention, and full accessibility qualification remain.
Calendar-aware recurrence and provider connections follow in R2; approvals, loops, and
sub-workflows follow in R3.

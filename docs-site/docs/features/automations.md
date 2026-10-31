---
title: Visual workflows
description: "Implementation status and intended authoring, testing, publishing, and inspection workflow for Warpdrive automations."
---

# Visual workflows

**Status: implementation in progress.** The first increment adds internal definition validation, permissions, and draft/version persistence. The application does not yet expose a visual builder or execute these definitions. Existing scheduled email and activity reminders continue to use their existing workers.

## Planned authoring experience

Create a workflow from a template or a blank trigger, add actions on a visual canvas or ordered-step view, and configure the selected step in a contextual panel. Use a variable picker to reference typed data from earlier steps. Conditions have named outcomes and explicit destinations.

Saving preserves a draft. Testing uses sample data and simulates external effects by default. Publication reviews the trigger, execution identity, permissions, connections, and effects before activating an immutable version. Existing runs stay attached to their original version.

The run inspector will show the executed path, step attempts, waiting conditions, redacted inputs/outputs, and actionable failures. Retry and cancellation need to respect effects that have already completed.

## Delivery sequence

1. Definition/version foundation, then a permission-checked manual CRM execution.
2. Workflow library, visual editor, typed data mapping, conditions, persistent waits, testing, publication, and run inspection.
3. Iranian calendar recurrence, business calendars, webhooks, and provider connections.
4. Approvals, bounded loops, sub-workflows, and open source extension contracts.

Farsi, German, and English are required throughout. Display language, scheduling calendar, and timezone remain independent.

## Scope of current permissions

Permission sets now include workflow view, create, edit, publish, run, and cancel flags. Regular users operate on their own workflows; administrators retain explicit administrative authority. Publishing is a high-risk permission. These flags prepare the feature and do not enable a UI or execution service by themselves.

## Implementation references

The repository's `docs/workflows/` directory holds the approved task plan, UX journeys, exact Mobbin references, architecture decisions, and status ledger. Consult that ledger for completed task evidence. Calendar/conferencing and analytics specifications remain separate projects until their implementations are available.

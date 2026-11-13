# Workflow step configuration

This guide covers the version 1 configuration profiles extended by WF-019
(issue #676). The inspector, publication, run admission, and task effect share
versioned descriptors and canonical CRM value rules. For the current version 2
block catalog, see [Workflow blocks](../workflow-blocks.md).

## Supported settings

| Profile      | Settings and behavior                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manual start | Automatic or custom name, 1–120 trimmed characters. The default launch requires a deal. A global launch uses `scope: "global"` and takes no deal.                                                                                                                                                                                                                                                                                                                                                                               |
| Read deal    | Required, nonnullable deal identity, selected from a scoped lookup or an actual compatible ancestor output. Other entities remain unready.                                                                                                                                                                                                                                                                                                              |
| Create task  | Required nonblank title through 255 characters. Linked deal may be omitted, explicitly null, a visible deal or a compatible ancestor identity. Task type and initiating actor remain server defaults. Activity custom fields use the rules below.                                                                                                                                                                                                       |
| Condition    | Flat comparisons support equals, does not equal, contains, and exists. See [Condition groups](conditions.md) for grouped comparisons and default paths.                                                                                                                                  |
| Wait         | Choose a duration or scheduled date. Configured durations accept days, hours, minutes, and seconds from literals or compatible outputs. A scheduled date accepts a compatible earlier output or a fixed instant. A mapped civil date resolves to midnight UTC. Existing literal minutes and fixed-instant definitions retain their original rules. See the [legacy fixed-instant contract](../development/workflow-fixed-instant-delay.md). |

A newly reached configured wait resolves its inputs against the run's current outputs.
The maximum delay is 365 days. A configured scheduled date must be at or after the
first time the step is reached. Once the wait is armed, the run keeps its stored
deadline across worker wakes.

The renderer uses descriptors for names, required/nullable fields, mode choices,
limits, labels and supported settings. Specialized controls implement interaction;
they do not substitute their own publication schema. An incomplete draft remains
saveable. Rendering fields creates no bindings, values, default IDs or history
entries. A real edit still uses the existing graph/history path.

## Custom field identity and values

A task's optional `config.customFields` map is keyed by the stable activity field
**definition UUID**. At validation/write time that UUID resolves to the same current
active definition, then to its canonical CRM key. Renaming the original definition
preserves the binding. Deleting/archiving it and creating a different UUID with the
same key or name does not redirect the saved value.

```json
{
  "subject": { "kind": "value", "value": "Review renewal" },
  "dealId": { "kind": "value", "value": null },
  "customFields": {
    "848408c6-faf7-4234-8de1-c63f1c9107dc": { "kind": "value", "value": 0 },
    "e96b131c-a58c-4469-84b1-81e249e653bc": {
      "kind": "value",
      "value": { "start": "2026-11-04", "end": "2026-11-05" }
    }
  }
}
```

The example UUIDs must correspond to actual numeric/date-range activity definitions;
it is a wire-shape example, not a runnable template or a claim that those fields exist.

All sixteen canonical types are included: text, autocomplete, large text, phone,
numeric, monetary, single option, multiple options, user, person, organization, date,
time, date range, time range and address. Literal arrays/objects remain native
values; neither JSON text nor labels replace their stored representation. Numeric
zero is retained. Monetary values follow the canonical finite-number/multiple-of-0.01
rule, including accepted negative values; no exact-decimal string coercion is added.
Dates/times use canonical ISO-date/HH:mm values independently of display preferences.
Ranges preserve ordered endpoints; addresses retain their known native members.

Only `isRequired` makes a field mandatory. `isImportant` is a hint; `showInAddForm`
does not hide applicable workflow fields. An untouched optional field is omitted.
Explicit Clear/Omit removes it; an authored empty text literal remains an authored
value and the canonical required rule decides validity. Custom null is invalid.
Builtin linked-deal null has its own explicit “No linked deal” state. Invalid input
stays available for correction instead of silently preserving an earlier valid value.

Canonical validation rejects missing/blank required values, invalid native types,
inactive option IDs and invalid ranges/addresses. The workflow boundary additionally
rejects unknown/archived definition UUIDs and unknown nested members before the
ordinary CRM parser can strip them. Existing unreviewed or unsupported settings are
retained with a safe explanation. The duplicate copier accepts only its reviewed
scalar/rich/incomplete shapes and returns copy-unavailable for other shapes; it does
not sanitize a graph into validity.

Reference choices come from actual earlier connected outputs and their declared
value/identity semantics. Numeric custom fields accept number outputs, without
coercing decimal strings. Text-family fields can use actual string outputs and still
require runtime target-value validation. No current output supplies custom option
identity, user/person/org identity, arrays, ranges or addresses, so these offer honest
literal controls rather than invented mappings. Retained incompatible mappings stay
visible with an error. All property paths retain the existing own-key/prototype and
bounded-path guards; the global scalar binding schema is unchanged.

## Current metadata, choices and authority

The version 1 read procedures are `workflows.configuration`, `configurationOptions`
and `configurationReferences`. Each call rehydrates the actor and checks current
workflow view plus owner/admin scope. Edit and archive state control authoring;
activity-create/task-type prerequisites warn about execution rather than denying an
otherwise authorized incomplete draft. Metadata management permission is not needed
to configure a workflow. A client snapshot/fingerprint never grants write, publish,
run or record access.

Definitions are delivered in pages (default 50, maximum 100), option pages default
50/maximum 100, and reference search pages default 25/maximum 100. Search is trimmed
and bounded to 200 characters. Reference targets are derived on the server from the
profile/current field, and visibility predicates apply before the SQL page limit.
Selected-ID hydration is separately scoped and returns only available ID/label pairs.
Hidden/deleted selections receive a generic unavailable state rather than a label or
an invented UUID display name.

The fingerprint describes the complete fresh active definition/option view. Cursor
continuations bind the current actor scope, workflow/profile, field/query/order/page
size and fingerprint. A changed definition view returns stale instead of mixed pages.
The client may render loaded fields while incomplete, but declares the configuration
complete only after the uninterrupted same-fingerprint field chain and all necessary
unfiltered option chains match their declared counts. A search result's final page is
not the complete option schema. Explicit continuation/retry controls preserve local
bindings and input; confirmed denial hides cached metadata/lookup labels until a
fresh positive current read.

Entry/request caps do **not** establish an aggregate byte or database-work bound.
Canonical field/option counts, option strings and several rich value strings have
no total bound today. Hashing and authoritative validation read the full current
schema. This change does not silently truncate it or impose a feature-only total cap.

## Publication and effects

Publication validates the actual graph with complete fresh activity definitions,
including required fields outside the first UI page. A valid publisher is checked by
its existing publish authority; the renderer's edit decision does not replace it.
New-run admission applies the same static contract to the pinned version. Replayed
requests retain the existing authority/idempotency path and return the existing run.

At each task effect the existing run transaction holds the run lock and uses the
freshly hydrated original actor. The actual pinned graph supplies ancestry/output
compatibility. The effect then prepares a fresh complete canonical definition view,
resolves UUID-keyed bindings, checks current user/person/org visibility and validates
before any activity write. The same server-only prepared parser/definitions reach
the canonical activity writer; a second cached parser cannot silently remove a key
already accepted by the workflow. Ordinary CRM callers keep their existing path.

Activity creation, step receipt, outputs and progress remain in the same transaction.
Simulation uses the same validation/write path inside its existing rollback savepoint,
with reminder scheduling disabled. The prepared view is current as of its read; it
is not a global metadata/visibility serialization fence. No global writer lock or
DDL counter is introduced. Graphs containing an own task `customFields` member,
including an empty map, remain outside the older failed-prefix retry profile until
that profile's custom provenance and authority behavior is separately qualified.

## Evidence checkpoint and remaining gates

The authentic current-API inspector baseline ran before WF-019 production: three
controls passed and three intended missing behaviors failed (field error association,
explicit linked-deal null, canonical custom-field rendering). The original bytes and
logs remain preserved. Future-contract tests were defined separately and are not
additional executed preproduction failures.

Local focused qualification passed all638Workflow unit cases across64files, including
132new implementation/regression cases plus six adapted baseline cases above the
parent's500cases. All526compared pins and46required executable raw source witnesses
held; cleanup completed. The26new real-PostgreSQL cases remain unexecuted locally.
The exact source inventory covers2482files with zero missing/invalid entries; its
report records the fingerprint and separate installation gates. Earlier actual
focused failures and their corrections remain preserved.

This document records a source implementation checkpoint. Full current-head types,
translations, lint, unit, real PostgreSQL, inventory and builds must be recorded on
the resulting PR before source qualification. Local components do not establish
actual database writes or authority behavior. Formal prerequisite acceptance,
native/browser/keyboard/screen-reader/RTL/theme/human journeys, main integration,
issue closure, release, deployment and provider/installation acceptance remain open.

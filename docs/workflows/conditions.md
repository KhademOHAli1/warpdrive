# Condition groups and the default path

A condition chooses exactly one outgoing path. A matching expression takes **True**;
a non-matching expression takes **Otherwise (default)**. Both connections must have
one valid destination. Missing input, an unavailable source, an invalid comparison
or a malformed connection is an error, never a reason to take the default path.

The editor supports **All conditions (AND)** and **Any condition (OR)**. Nested
groups make precedence explicit. Rows can be added, removed or moved while keeping
their stable identity. Undo and redo apply to each explicit edit. Existing flat
conditions stay flat until the author chooses **Convert to group**; opening or
reviewing a workflow does not convert it.

Choose a source from supported outputs on the connected predecessor path. The
comparison value uses the selected source's type. A deleted, moved or incompatible
source stays visible as an invalid selection until it is repaired. An already open
picker cannot apply a choice to a different row after reordering. Readonly,
archived or denied views cannot change configuration.

## Values and comparison

- **Exists** treats false, zero and empty text as present. Explicit null is absent.
- **Is empty** matches empty text. It does not match null, whitespace or nonempty
  text. A non-null value of another type is invalid.
- **Equals**, **Does not equal** and **Contains** use supported semantic types
  without implicit numeric, date or identity conversion.
- Exact decimal values remain stored text. For equality, enter a complete decimal
  spelling; `1.0` and `1.00` remain different. Contains accepts an exact text
  fragment, including empty text. Native numbers and generic text sources do not
  stand in for an exact decimal source.
- Civil dates and instants retain their explicit types. Civil dates have no time
  zone; instants require an offset. Invalid raw edits remain available for repair.

Missing output differs from explicit null. A needed missing output fails the step.
The engine validates every static source before evaluating the group, then evaluates
children in their displayed order: AND stops at false, OR stops at true. A skipped
runtime value is not resolved, but an invalid static source in that row still makes
the configuration invalid. Previews use authored literals or labeled synthetic
examples; they do not fetch CRM records or historical execution payloads.

## Bounds and compatibility

An executable condition supports at most three group levels, eight children per
group, 32 predicates and 48 expression nodes. Empty groups and known incomplete
rows can remain drafts within these bounds. Over-limit or unknown structures are
rejected without silently truncating authored input. These count limits do not
establish aggregate request-byte or database-work bounds.

The version1 wire format retains existing flat conditions or uses one grouped
expression with `defaultPort: "false"`. True and false ports remain exclusive;
groups add no parallel branches or joins. Copying preserves reviewed incomplete
configuration as an inert detached draft. Grouped configuration is excluded from
the older failed-task retry profile pending its separate recovery qualification.
Published versions and completed receipts are not converted or backfilled.

Source and focused/hosted validation are recorded separately in the Workflow status
ledger. Native keyboard, assistive-technology, RTL/theme and human acceptance,
main integration, release, deployment and installation acceptance remain separate
gates.

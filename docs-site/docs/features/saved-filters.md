---
sidebar_position: 11
title: Filters and saved views
description: "Multi-condition filters in Warpdrive: the condition builder, operators, match all or any, and saved views for deals, people, organizations, and leads."
---

# Filters and saved views

Deals, people, organizations, and leads share one condition builder, and a filter
built on any of them can be saved as a named view and reused instead of rebuilt each
time.

## Building a filter

The Filter control on each surface opens the builder. A filter is a set of
conditions, each naming a field, an operator, and usually a value.

![Saving a filter, with the shared-with-everyone option](/img/screenshots/saved-filters/create.png)

Fields cover the entity's own columns plus **labels**. Label matching is
case-insensitive and a label condition can name several labels at once ("is any
of"), so it matches everything the chips display as one label regardless of casing.

Available operators depend on the field. For example, a text field can offer
**contains**, **does not contain**, or **starts with**. On deals, **Value is
not 5** also matches rows with an empty value. Add **Value is not empty** and
use **match all** to exclude them.

Conditions combine as **match all** or **match any**.

## Saving a filter

Build the conditions you want, then save the view with a name. Open the **Filter**
menu on the board or use the saved filters or views control in the list toolbar
to reopen a saved view.

On the board, reopening the builder with a saved filter active loads its
conditions. Save to update a filter you own or create a copy of a shared filter.
You can also delete views you own from the saved filters menu.

## Sharing

A saved filter starts private. If you have the **Share filters** permission,
select **Shared with everyone** when saving to make it available to colleagues.
Only the owner can change or delete a saved filter.

Sharing a filter shares the **definition**, not the results. Each person still sees
only the records they are allowed to see, so the same shared filter legitimately
returns different rows for different people.

## Filters and totals

When a filter is active, stage totals describe the filtered board. The list
footer reflects the filtered results and, with an owner filter active, counts
only the loaded matches. See [Pipeline](./pipeline.md#list).

## Related

- [Pipeline](./pipeline.md)
- [Visibility groups](../administration/visibility-groups.md)

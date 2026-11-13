---
sidebar_position: 5
title: Activities
description: "Calls, meetings, and tasks in Warpdrive: scheduling against deals and contacts, the list and calendar views, completion, and overdue handling."
---

# Activities

Use activities to track calls, meetings, and tasks. You can attach them to CRM
records or leave them unlinked.

## Regional calendar behavior

The calendar and shared date pickers support Gregorian and Iranian Solar Hijri
calendars. Select the display calendar and account timezone in
[Regional settings](./regional-settings.md). Farsi has RTL layout and a digit choice;
German has localized date and numeric input. Changing display preferences does not
reschedule stored activities.

For a meeting with a video call, use the link saved on the activity. Check the
meeting in the conferencing provider to confirm its status.

## Views

`/activities/list` is the table view and `/activities/calendar` is the calendar.

![The activities list](/img/screenshots/activities/list.png)

Use the list to sort and filter your work. Use the calendar to check for conflicts
before scheduling.

Opening a list row or a chip in the week grid opens the linked deal, lead, person,
or organization, in that order when more than one link is present. A list row
without a linked record opens the activity editor. In the list, use the round
toggle to mark an activity done or the square checkbox to select the row. Press
`j` or `k` to move through the rows and Enter to open the selected row. See
[Keyboard shortcuts](./keyboard-shortcuts.md).

![The activities calendar](/img/screenshots/activities/calendar.png)

Screenshots illustrate earlier captures; navigation, theme, and localized date controls
may differ from the current maintained fork.

The week calendar has a time gutter, a line at the current minute, and a highlighted
today column, and it opens scrolled to the working day. Activities without a time
sit in a dedicated all-day lane above the hour grid rather than being drawn at
midnight. Overlapping activities render side by side; past two lanes they collapse
into a counted "+N more" popover. The week shown is your local week, computed in
your timezone rather than the server's.

## Scheduling

An activity can be created from the activities views, or directly on a deal, person,
or organization, which links it to that record.

An activity has a type, a subject, an optional due date and time, a duration, a
priority, and an assignee. Activity types are configurable, see
[Company settings](../administration/company-settings.md).

Activities without a due date are valid. They appear as undated rather than being
treated as overdue.

The calendar inside the due-date picker shows how loaded each day already is for the
assignee, so a follow-up can be placed on a lighter day. Load is measured against a
personal daily activity target set on `/settings/profile`, and is informational
only: a full day never blocks a save.

## Completion and overdue

Activities are marked done from the list, the calendar, or the record they belong to.
An incomplete activity past its due date is styled as overdue. An activity can be
deleted from its card's overflow menu on the record.

A deal's next activity is surfaced on its board card, which is what makes the board
usable as a work queue rather than only a status display.

## Visibility

For an activity linked to a deal, access follows the deal and its pipeline. For
other linked activities, a linked person takes precedence over an organization.
An activity linked only to a lead uses assignee and participant access rules. To
check what a colleague can see, review the activity from their role in the list
and calendar.

See [Visibility groups](../administration/visibility-groups.md).

## Related

- [Deal workspace](./deal-workspace.md)
- [Performance](./dashboard.md)
- [Keyboard shortcuts](./keyboard-shortcuts.md)

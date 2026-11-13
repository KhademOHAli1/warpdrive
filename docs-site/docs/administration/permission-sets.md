---
title: Permission sets
description: "How Warpdrive permission sets work: capability flags, the own, team, and any scopes, administrator bypass, and how permissions combine with record visibility."
---

# Permission sets

A permission set is a named collection of capability flags assigned to a user.
`/settings/permission-sets` manages them.

![Permission sets](/img/screenshots/permission-sets/list.png)

Two sets are seeded on first run: **Regular** and **Admin**.

## Visibility first, then permission

Warpdrive checks record visibility before deciding whether you can perform a
record-scoped action.

Permissions do not widen visibility. A permission granting an action on "any" record
means any record **you can already see**, not every record in the database. Which
records you can see is decided separately by
[visibility groups](/administration/visibility-groups/).

A record you cannot see reports not found, not permission denied, so the interface
never reveals that a record exists.

## Scopes

Record-scoped capabilities come in three scopes:

| Scope | Applies to |
| --- | --- |
| `_own` | records you own |
| `_team` | records owned by a member of a team you **manage** |
| `_any` | any record visible to you |

`_team` is evaluated after normal visibility succeeds, so managing a team does not by
itself let you see its members' records.

## Administrators

Administrators bypass flag evaluation entirely.

**Inactive users are denied before that bypass applies.** A deactivated administrator
has no access, which is what makes deactivation a complete revocation rather than a
partial one.

## High-risk permissions

Some capabilities are treated as high-risk and cannot be handed out by a
non-administrator holding `permissions.manage`. A delegated manager also cannot
edit their own set, change their own assignment, or change the permission set
assigned to an administrator.

## Entities and activities are scoped differently

An activity linked to a deal follows that deal's visibility and pipeline
restriction. Without a deal, the linked person or organization can determine
visibility. See [Visibility groups](/administration/visibility-groups/#entities-and-activities).

Check access to both records and activities from an account that uses the restricted
set. An assignee can edit and complete a visible activity even without the ordinary
edit and complete flags. Deletion has its own permission check.

## Related

- [Visibility groups](/administration/visibility-groups/), which decide what is visible in the
  first place.
- [Users and teams](/administration/users-and-teams/), for assigning sets.
